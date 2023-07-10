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
import ts from 'typescript';
import { TsOptionsLiteral } from './ts/ts-options-literal.js';
import { UctSetup } from './uct-setup.js';
import { UctCompileSerializerFn } from './uct-tasks.js';

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

  configure(sourceFile: ts.SourceFile, symbol: ts.Symbol, node: ts.Node): void {
    const { options } = new TsOptionsLiteral(this.#setup, symbol.name, node);
    const dist = options.dist.getString();

    if (dist != null) {
      this.#distFile = path.resolve(sourceFile.fileName, dist);
    }

    // TODO extract bundle data
  }

  compileUcDeserializer(task: UctCompileSerializerFn): void {
    (this.#ucdModels ??= new EsCode()).write(this.#addModel(task));
  }

  compileUcSerializer(task: UctCompileSerializerFn): void {
    (this.#ucsModels ??= new EsCode()).write(this.#addModel(task));
  }

  #addModel({ fnId, modelId, from }: UctCompileSerializerFn): EsSnippet {
    const moduleName = from.endsWith('ts')
      ? from.slice(0, -2) + 'js'
      : from.endsWith('tsx')
      ? from.slice(0, -3) + '.js'
      : from;
    const modulePath = path.relative(this.#setup.tsRoot.rootDir!, moduleName);
    let moduleSpec = modulePath.replaceAll(path.sep, '/');

    if (!moduleSpec.startsWith('./') && !moduleSpec.startsWith('../')) {
      moduleSpec = './' + moduleSpec;
    }

    const model = esImport(moduleSpec, modelId.text);

    return esline`${fnId}: ${model},`;
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
                ucdCompiler.declare({
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
                ucsCompiler.declare({
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
