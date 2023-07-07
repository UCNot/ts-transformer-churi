import { EsFunction, EsSignature, esGenerate, esline } from 'esgen';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { UctBundle } from './uct-bundle.js';
import { wrapUctCompilerHost } from './uct-compiler-host.js';
import { UctSetup } from './uct-setup.js';
import { UctCompileFn, UctTasks } from './uct-tasks.js';
import { UctVfs } from './uct-vfs.js';

export class UctLib implements UctTasks {

  readonly #setup: UctSetup;
  readonly #printer: ts.Printer;
  readonly #tasks: (() => void)[] = [];
  readonly #vfs: Record<string, string> = {};
  readonly #bundle: UctBundle;
  #rootDir?: string;

  constructor(setup: UctSetup) {
    this.#setup = setup;
    this.#printer = ts.createPrinter(setup.program.getCompilerOptions());
    this.#bundle = new UctBundle(this, setup.dist);
  }

  get rootDir(): string | undefined {
    return this.#rootDir;
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
    this.#tasks.push(() => this.#bundle.compileUcDeserializer(task));
  }

  compileUcSerializer(task: UctCompileFn): void {
    this.#tasks.push(() => this.#bundle.compileUcSerializer(task));
  }

  async emitBundler(): Promise<UctLib.Bundler | undefined> {
    const bundler = this.#emitBundler();

    if (!bundler) {
      return;
    }

    return {
      fileName: path.join(this.#rootDir!, `${BUNDLER_FILE_NAME}.ts`),
      sourceText: await esGenerate(esline`await ${bundler.call()};`),
    };
  }

  #emitBundler(): EsFunction<EsSignature.NoArgs> | undefined {
    this.#tasks.forEach(task => task());

    return this.#bundle.emitBundlerFn();
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
