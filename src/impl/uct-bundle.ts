import { UcFormatName, UcPresentationName } from 'churi';
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
  #presentations?: EsCode;
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

  #addDeserializer({ fnId, modelId, from, mode, format }: UctCompileDeserializerFn): EsSnippet {
    const moduleSpec = this.#setup.relativeImport(this.#setup.tsRoot.rootDir!, from);
    const model = esImport(moduleSpec, modelId.text);
    let lexerOptions: UctLexerOptions | undefined;

    if (format !== 'tokens') {
      lexerOptions = UCT_FORMAT_LEXERS[format];

      this.#addPresentation(format);
      this.#addPresentations(lexerOptions?.presentations);
    }

    return code => {
      code
        .write(esline`${fnId}: {`)
        .indent(code => {
          code.write(esline`model: ${model},`).write(`mode: ${esStringLiteral(mode)},`);
          if (lexerOptions) {
            const { lexer, inset } = lexerOptions;

            code.write(esline`lexer: ${lexer},`);
            if (inset) {
              code.write(esline`inset: ${inset},`);
            }
          }
        })
        .write('}');
    };
  }

  #addPresentation(presentation: UcPresentationName): void {
    (this.#presentations ??= new EsCode()).write(esStringLiteral(presentation) + ',');
  }

  #addPresentations(presentations: readonly UcPresentationName[] | undefined): void {
    presentations?.forEach(presentation => this.#addPresentation(presentation));
  }

  compileUcSerializer(task: UctCompileSerializerFn): void {
    (this.#ucsModels ??= new EsCode()).write(this.#addSerializer(task));
  }

  #addSerializer({ fnId, modelId, from }: UctCompileSerializerFn): EsSnippet {
    const moduleSpec = this.#setup.relativeImport(this.#setup.tsRoot.rootDir!, from);
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
                ucdCompiler.const({
                  value: () => code => {
                    code.multiLine(code => {
                      code
                        .write(esline`new ${UcdCompiler}({`)
                        .indent(code => {
                          code.write(`models: {`).indent(ucdModels).write(`},`);
                          code.write(this.#presentationsOption());
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

  #presentationsOption(): EsSnippet {
    const presentations = this.#presentations;

    if (!presentations) {
      return EsCode.none;
    }

    return code => {
      code.write(`presentations: [`).indent(presentations).write(`],`);
    };
  }

}

const UCT_FORMAT_LEXERS: {
  readonly [format in UcFormatName]: UctLexerOptions;
} = {
  charge: {
    lexer: createLexerOption('UcChargeLexer'),
  },
  plainText: {
    lexer: createLexerOption('UcPlainTextLexer'),
  },
  uriEncoded: {
    lexer: createLexerOption('UcURIEncodedLexer'),
  },
  uriParams: {
    presentations: ['uriParam'],
    lexer: createLexerOption('UcURIParamsLexer'),
    inset: createLexerOption('UcChargeLexer'),
  },
};

interface UctLexerOptions {
  presentations?: readonly UcPresentationName[] | undefined;
  readonly lexer: EsSnippet;
  readonly inset?: EsSnippet | undefined;
}

function createLexerOption(lexer: string, from = 'churi'): EsSnippet {
  return code => {
    code
      .write(esline`({ emit }) => code => {`)
      .indent(code => {
        const $esImport = esImport('esgen', 'esImport');

        code
          .write(
            esline`const Lexer = ${$esImport}(${esStringLiteral(from)}, ${esStringLiteral(
              lexer,
            )});`,
          )
          .write(`code.line('return new ', Lexer, '(', emit, ');');`);
      })
      .write('}');
  };
}
