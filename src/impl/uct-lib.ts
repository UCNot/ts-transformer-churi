import { UccCode, UccLib, UccSource } from 'churi/compiler.js';
import { jsStringLiteral } from 'httongue';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { wrapUctCompilerHost } from './uct-compiler-host.js';
import { UctSetup } from './uct-setup.js';
import { UctCompileFn, UctTasks } from './uct-tasks.js';
import { UctVfs } from './uct-vfs.js';

export class UctLib extends UccLib implements UctTasks {

  readonly #setup: UctSetup;
  readonly #printer: ts.Printer;
  readonly #tasks: (() => void)[] = [];
  readonly #vfs: Record<string, string> = {};
  #rootDir?: string;

  #ucdModels?: UccCode;
  #ucsModels?: UccCode;

  constructor(setup: UctSetup) {
    super();

    this.#setup = setup;
    this.#printer = ts.createPrinter(setup.program.getCompilerOptions());
  }

  replaceSourceFile(sourceFile: ts.SourceFile): void {
    const text = this.#printer.printFile(sourceFile);

    this.#vfs[sourceFile.fileName] = text;
    this.#updateRootDir(sourceFile);
  }

  #updateRootDir({ fileName }: ts.SourceFile): void {
    const dir = path.dirname(fileName);

    if (!this.#rootDir) {
      this.#rootDir = dir;

      return;
    }

    let rootFragments = this.#rootDir.split(path.sep);
    let dirFragments = dir.split(path.sep);

    if (dirFragments.length < rootFragments.length) {
      [rootFragments, dirFragments] = [dirFragments, rootFragments];
    }

    for (let i = 0; i < rootFragments.length; ++i) {
      if (rootFragments[i] !== dirFragments[i]) {
        this.#rootDir = rootFragments.slice(0, i).join(path.sep);
      }
    }
  }

  compileUcDeserializer(task: UctCompileFn): void {
    this.#tasks.push(() => this.#compileUcDeserializer(task));
  }

  #compileUcDeserializer(task: UctCompileFn): void {
    (this.#ucdModels ??= new UccCode()).write(this.#addModel(task));
  }

  compileUcSerializer(task: UctCompileFn): void {
    this.#tasks.push(() => this.#compileUcSerializer(task));
  }

  #compileUcSerializer(task: UctCompileFn): void {
    (this.#ucsModels ??= new UccCode()).write(this.#addModel(task));
  }

  #addModel({ fnId, modelId, from }: UctCompileFn): UccSource {
    const moduleName = from.endsWith('ts')
      ? from.slice(0, -2) + 'js'
      : from.endsWith('tsx')
      ? from.slice(0, -3) + '.js'
      : from;
    const modulePath = path.relative(this.#rootDir!, moduleName);
    let moduleSpec = modulePath.replaceAll(path.sep, '/');

    if (!moduleSpec.startsWith('./') && !moduleSpec.startsWith('../')) {
      moduleSpec = './' + moduleSpec;
    }

    const model = this.import(moduleSpec, modelId.text);

    return `${fnId}: ${model},`;
  }

  async emitBundler(): Promise<UctLib.Bundler | undefined> {
    if (!this.#emitBundler()) {
      return;
    }

    return {
      fileName: path.join(this.#rootDir!, `${BUNDLER_FILE_NAME}.ts`),
      sourceText: await this.bundle.compile().toText(),
    };
  }

  #emitBundler(): boolean {
    this.#tasks.forEach(task => task());

    const ucdModels = this.#ucdModels;
    const ucsModels = this.#ucsModels;

    if (!ucdModels && !ucsModels) {
      return false;
    }

    const emitBundle = this.declarations.declareFunction(
      'emitBundle',
      [],
      ({ ns }) => code => {
          const writeFile = this.import('node:fs/promises', 'writeFile');
          const bundle = ns.name('bundle');
          const UccBundle = this.import('churi/compiler.js', 'UccBundle');

          code.write(`const ${bundle} = new ${UccBundle};`);
          if (ucdModels) {
            const UcdSetup = this.import('churi/compiler.js', 'UcdSetup');

            code
              .write(`await new ${UcdSetup}({`)
              .indent(code => {
                code.write(`bundle: ${bundle},`).write(`models: {`).indent(ucdModels).write(`},`);
              })
              .write('}).bootstrap();');
          }
          if (ucsModels) {
            const UcsSetup = this.import('churi/compiler.js', 'UcsSetup');

            code
              .write(`await new ${UcsSetup}({`)
              .indent(code => {
                code.write(`bundle: ${bundle},`).write(`models: {`).indent(ucsModels).write(`},`);
              })
              .write(`}).bootstrap();`);
          }
          code
            .write(`await ${writeFile}(`)
            .indent(code => {
              code
                .write(jsStringLiteral(this.#setup.dist) + ',')
                .write(`await ${bundle}.compile().toText(),`, '');
            })
            .write(');');
        },
      {
        async: true,
      },
    );

    this.bundle.body.write(`await ${emitBundle}();`);

    return true;
  }

  async compile(): Promise<void> {
    const bundler = await this.emitBundler();

    if (!bundler) {
      return;
    }

    const tempDir = await this.#setup.createTempDir();

    try {
      const compiler = this.#emitCompiler(bundler, tempDir, { ...this.#setup.vfs, ...this.#vfs });

      await import(compiler);
    } finally {
      await fs.rm(tempDir, { recursive: true });
    }
  }

  #emitCompiler({ fileName, sourceText }: UctLib.Bundler, outDir: string, vfs?: UctVfs): string {
    const programOptions = this.#setup.program.getCompilerOptions();
    const options: ts.CompilerOptions = {
      ...programOptions,
      declaration: false,
      emitDeclarationOnly: false,
      module: ts.ModuleKind.ES2022,
      noEmit: false,
      sourceMap: false,
      target: ts.ScriptTarget.ES2022,
      outDir,
    };

    const host = wrapUctCompilerHost(ts.createCompilerHost(options, true), {
      ...vfs,
      [fileName]: sourceText,
    });

    const program = ts.createProgram({
      rootNames: [fileName],
      options,
      host,
    });

    if (this.#setup.reportErrors(ts.getPreEmitDiagnostics(program))) {
      throw new Error(`Failed to emit schema compiler`);
    }

    let compilerFile: string | undefined;
    const { diagnostics } = program.emit(
      undefined,
      (jsFileName, text, writeByteOrder, onError, sourceFiles, data) => {
        host.writeFile(jsFileName, text, writeByteOrder, onError, sourceFiles, data);
        if (sourceFiles?.some(src => src.fileName === fileName)) {
          compilerFile = jsFileName;
        }
      },
    );

    if (this.#setup.reportErrors(diagnostics)) {
      throw new Error(`Failed to emit schema compiler`);
    }

    if (!compilerFile) {
      throw new Error(`Schema compiler not emitted`);
    }

    return compilerFile;
  }

}

const BUNDLER_FILE_NAME = 'uc-lib.bundler';

export namespace UctLib {
  export interface Bundler {
    readonly fileName: string;
    readonly sourceText: string;
  }
}
