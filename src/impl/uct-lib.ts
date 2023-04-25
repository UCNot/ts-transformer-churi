import { isPresent } from '@proc7ts/primitives';
import { UccCode, UccLib, UccSource } from 'churi/compiler';
import path from 'node:path';
import ts from 'typescript';
import { jsStringLiteral } from './js.js';
import { wrapUctCompilerHost } from './uct-compiler-host.js';
import { UctSetup } from './uct-setup.js';
import { UctCompileFn, UctTasks } from './uct-tasks.js';
import { UctVfs } from './uct-vfs.js';

export class UctLib extends UccLib implements UctTasks {

  readonly #setup: UctSetup;
  readonly #tasks: (() => void)[] = [];
  #rootDir?: string;

  #ucdModels?: UccCode;
  #ucsModels?: UccCode;

  constructor(setup: UctSetup) {
    super();

    this.#setup = setup;
  }

  compileUcDeserializer(task: UctCompileFn): void {
    this.#updateRootDir(task.from);
    this.#tasks.push(() => this.#compileUcDeserializer(task));
  }

  #compileUcDeserializer(task: UctCompileFn): void {
    (this.#ucdModels ??= new UccCode()).write(this.#addModel(task));
  }

  compileUcSerializer(task: UctCompileFn): void {
    this.#updateRootDir(task.from);
    this.#tasks.push(() => this.#compileUcSerializer(task));
  }

  #compileUcSerializer(task: UctCompileFn): void {
    (this.#ucsModels ??= new UccCode()).write(this.#addModel(task));
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

  #addModel({ fnId, modelId, from: { fileName } }: UctCompileFn): UccSource {
    const moduleName = fileName.endsWith('ts')
      ? fileName.slice(0, -2) + 'js'
      : fileName.endsWith('tsx')
      ? fileName.slice(0, -3) + '.js'
      : fileName;
    const modulePath = path.relative(this.#rootDir!, moduleName);
    let moduleSpec = modulePath.replaceAll(path.sep, '/');

    if (!moduleSpec.startsWith('./') && !moduleSpec.startsWith('../')) {
      moduleSpec = './' + moduleSpec;
    }

    const model = this.import(moduleSpec, modelId);

    return `${fnId}: ${model},`;
  }

  async emitCompilerSource(): Promise<UctLib.CompilerSource | undefined> {
    const code = this.#toCompilerCode();

    if (!code) {
      return;
    }

    return {
      fileName: path.join(this.#rootDir!, `${COMPILER_FILE_NAME}.ts`),
      sourceText: await new UccCode()
        .write(this.imports.asStatic(), '', this.declarations, '', code)
        .toText(),
    };
  }

  #toCompilerCode(): UccSource | undefined {
    this.#tasks.forEach(task => task());

    const fns = [this.#compileDeserializers(), this.#compileSerializers()].filter(isPresent);

    if (!fns.length) {
      return;
    }
    if (fns.length === 1) {
      return `await ${fns[0]}();`;
    }

    return code => {
      code
        .write(`await Promise.all[`)
        .indent(...fns.map(fn => `${fn}(),`))
        .write(']);');
    };
  }

  #compileDeserializers(): string | undefined {
    const ucdModels = this.#ucdModels;

    if (!ucdModels) {
      return;
    }

    const writeFile = this.import('node:fs/promises', 'writeFile');
    const UcdLib = this.import('churi/compiler', 'UcdLib');

    return this.declarations.declare('compileDeserializers', ({ init }) => init(code => {
        code
          .write(`async () => await ${writeFile}(`)
          .indent(code => {
            code
              .write(jsStringLiteral(this.#setup.dist.deserializer) + ',')
              .write(`await new ${UcdLib}({`)
              .indent(ucdModels)
              .write('}).compileModule().toText(),', '');
          })
          .write(')');
      }));
  }

  #compileSerializers(): string | undefined {
    const ucsModels = this.#ucsModels;

    if (!ucsModels) {
      return;
    }

    const writeFile = this.import('node:fs/promises', 'writeFile');
    const UcsLib = this.import('churi/compiler', 'UcsLib');

    return this.declarations.declare('compileSerializers', ({ init }) => init(code => {
        code
          .write(`async () => await ${writeFile}(`)
          .indent(code => {
            code
              .write(jsStringLiteral(this.#setup.dist.serializer) + ',')
              .write(`await new ${UcsLib}({`)
              .indent(ucsModels)
              .write('}).compileModule().toText(),', '');
          })
          .write(')');
      }));
  }

  async compile(vfs?: UctVfs): Promise<void> {
    const source = await this.emitCompilerSource();

    if (!source) {
      return;
    }

    const tempDir = await this.#setup.createTempDir();

    try {
      const compiler = this.#emitCompiler(source, tempDir, vfs);

      await import(compiler);
    } finally {
      // await fs.rm(tempDir, { recursive: true });
    }
  }

  #emitCompiler(
    { fileName, sourceText }: UctLib.CompilerSource,
    outDir: string,
    vfs?: UctVfs,
  ): string {
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

    const { diagnostics, emittedFiles = [] } = program.emit();

    if (this.#setup.reportErrors(diagnostics)) {
      throw new Error(`Failed to emit schema compiler`);
    }

    console.debug(emittedFiles);

    const compilerFile = emittedFiles.find(file => path.parse(file).name === COMPILER_FILE_NAME);

    if (!compilerFile) {
      throw new Error(`Schema compiler not emitted`);
    }

    return compilerFile;
  }

}

const COMPILER_FILE_NAME = 'uc-lib.compiler';

export namespace UctLib {
  export interface CompilerSource {
    readonly fileName: string;
    readonly sourceText: string;
  }
}
