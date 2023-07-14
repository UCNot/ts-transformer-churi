import { EsFunction, EsSignature, esGenerate, esline } from 'esgen';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { wrapTsCompilerHost } from './ts/ts-compiler-host.js';
import { TsVfs } from './ts/ts-vfs.js';
import { UctBundleRegistry } from './uct-bundle-registry.js';
import { UctSetup } from './uct-setup.js';
import { UctCompileDeserializerFn, UctCompileSerializerFn, UctTasks } from './uct-tasks.js';

export class UctLib implements UctTasks {

  readonly #setup: UctSetup;
  readonly #bundleRegistry: UctBundleRegistry;
  readonly #printer: ts.Printer;
  readonly #tasks: (() => void)[] = [];
  readonly #vfs: Record<string, string> = {};

  constructor(setup: UctSetup) {
    this.#setup = setup;
    this.#bundleRegistry = setup.bundleRegistry;
    this.#printer = ts.createPrinter(setup.program.getCompilerOptions());
  }

  replaceSourceFile(sourceFile: ts.SourceFile): void {
    const text = this.#printer.printFile(sourceFile);

    this.#vfs[sourceFile.fileName] = text;
  }

  compileUcDeserializer(task: UctCompileDeserializerFn): void {
    this.#tasks.push(() => task.bundle.compileUcDeserializer(task));
  }

  compileUcSerializer(task: UctCompileSerializerFn): void {
    this.#tasks.push(() => task.bundle.compileUcSerializer(task));
  }

  async emitBundler(): Promise<UctLib.Bundler | undefined> {
    const bundlerFns = [...this.#emitBundlerFns()];

    if (!bundlerFns.length) {
      return;
    }

    return {
      fileName: path.join(this.#setup.tsRoot.rootDir!, `${BUNDLER_FILE_NAME}.ts`),
      sourceText: await esGenerate(code => {
        for (const bundlerFn of bundlerFns) {
          code.write(esline`await ${bundlerFn.call()};`);
        }
      }),
    };
  }

  *#emitBundlerFns(): IterableIterator<EsFunction<EsSignature.NoArgs>> {
    this.#tasks.forEach(task => task());

    for (const bundle of this.#bundleRegistry.bundles()) {
      const bundlerFn = bundle.emitBundlerFn();

      if (bundlerFn) {
        yield bundlerFn;
      }
    }
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

  #emitCompiler({ fileName, sourceText }: UctLib.Bundler, outDir: string, vfs?: TsVfs): string {
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

    const host = wrapTsCompilerHost(ts.createCompilerHost(options, true), {
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
