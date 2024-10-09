import {
  EsCode,
  EsFunction,
  EsSignature,
  EsSnippet,
  EsSymbol,
  EsVarSymbol,
  esImport,
  esStringLiteral,
  esline,
} from 'esgen';
import path from 'node:path';
import { UctSetup } from './uct-setup.js';
import { UctCompileDeserializerFn, UctCompileSerializerFn } from './uct-tasks.js';

export class UctBundle {
  readonly #setup: UctSetup;
  #distFile: string;
  #ucdModels?: EsCode;
  #ucsModels?: EsCode;

  constructor(setup: UctSetup, distFile: string) {
    this.#setup = setup;
    this.#distFile = distFile;
  }

  get distFile(): string {
    return this.#distFile;
  }

  configure({ distFile }: { readonly distFile?: string | undefined }): void {
    if (distFile != null) {
      this.#distFile = path.resolve(
        path.dirname(this.#setup.bundleRegistry.defaultBundle.distFile),
        distFile,
      );
    }
  }

  compileUcDeserializer(task: UctCompileDeserializerFn): void {
    (this.#ucdModels ??= new EsCode()).write(this.#addDeserializer(task));
  }

  #addDeserializer({ fnId, modelId, from, mode, byTokens }: UctCompileDeserializerFn): EsSnippet {
    const moduleSpec = this.#setup.relativeImport(this.#setup.tsRoot.rootDir!, from);
    const model = esImport(moduleSpec, modelId.text);

    return code => {
      code
        .write(esline`${fnId}: {`)
        .indent(
          esline`model: ${model},`,
          `mode: ${esStringLiteral(mode)},`,
          `byTokens: ${byTokens},`,
        )
        .write('}');
    };
  }

  compileUcSerializer(task: UctCompileSerializerFn): void {
    (this.#ucsModels ??= new EsCode()).write(this.#addSerializer(task));
  }

  #addSerializer({ fnId, modelId, from }: UctCompileSerializerFn): EsSnippet {
    const moduleSpec = this.#setup.relativeImport(this.#setup.tsRoot.rootDir!, from);
    const model = esImport(moduleSpec, modelId.text);

    return code => {
      code
        .write(esline`${fnId}: {`)
        .indent(esline`model: ${model},`)
        .write('},');
    };
  }

  emitBundlerFn(): EsFunction<EsSignature.NoArgs> | undefined {
    const ucdModels = this.#ucdModels;
    const ucsModels = this.#ucsModels;

    if (!ucdModels && !ucsModels) {
      return;
    }

    return new EsFunction(
      'emitBundle',
      {},
      {
        declare: {
          at: 'bundle',
          async: true,
          body: () => code => {
            const writeFile = esImport('node:fs/promises', 'writeFile');
            const compilers: EsSymbol[] = [];

            if (ucdModels) {
              const UcdCompiler = esImport('churi/compiler.js', 'UcdCompiler');
              const ucdCompiler = new EsVarSymbol('ucdCompiler');

              compilers.push(ucdCompiler);
              code.write(
                ucdCompiler.const({
                  value: () => code => {
                    code.multiLine(code => {
                      code
                        .write(esline`new ${UcdCompiler}({`)
                        .indent(code => {
                          code.write(`models: {`).indent(ucdModels).write(`},`);
                        })
                        .write('})');
                    });
                  },
                }),
              );
            }
            if (ucsModels) {
              const UcsCompiler = esImport('churi/compiler.js', 'UcsCompiler');
              const ucsCompiler = new EsVarSymbol('ucsCompiler');

              compilers.push(ucsCompiler);
              code.write(
                ucsCompiler.const({
                  value: () => code => {
                    code.multiLine(code => {
                      code
                        .write(esline`await new ${UcsCompiler}({`)
                        .indent(code => {
                          code.write(`models: {`).indent(ucsModels).write(`},`);
                        })
                        .write(`})`);
                    });
                  },
                }),
              );
            }

            code
              .write(esline`await ${writeFile}(`)
              .indent(code => {
                code.write(esStringLiteral(this.#distFile) + ',').line(code => {
                  code.multiLine(code => {
                    const generate = esImport('esgen', 'esGenerate');

                    code
                      .write(esline`await ${generate}({`)
                      .indent(code => {
                        code
                          .write('setup: [')
                          .indent(code => {
                            for (const compiler of compilers) {
                              code.line(esline`await ${compiler}.bootstrap(),`);
                            }
                          })
                          .write('],');
                      })
                      .write('}),');
                  });
                });
              })
              .write(');');
          },
        },
      },
    );
  }
}
