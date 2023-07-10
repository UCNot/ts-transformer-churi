import { PackageInfo, PackageJson } from '@run-z/npk';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { ChuriTsLib } from './churi.ts-lib.js';
import { reportTsErrors } from './report-ts-errors.js';
import { TsInit } from './ts-init.js';
import { TsLibs } from './ts-libs.js';
import { TsVfs } from './ts-vfs.js';

export class TsSetup {

  readonly #program: ts.Program;
  readonly #typeChecker: ts.TypeChecker;
  readonly #vfs: TsVfs;
  readonly #tempDir: string | undefined;
  readonly #libs: TsLibs;
  readonly #formatHost: ts.FormatDiagnosticsHost;
  #packageInfo?: PackageInfo;

  constructor({ program, vfs = {}, tempDir }: TsInit) {
    this.#program = program;
    this.#typeChecker = program.getTypeChecker();
    this.#vfs = vfs;
    this.#tempDir = tempDir;
    this.#libs = {
      churi: new ChuriTsLib(this),
    };
    this.#formatHost = {
      getCurrentDirectory: program.getCurrentDirectory.bind(program),
      getNewLine: () => ts.sys.newLine,
      getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? f => f : f => f.toLowerCase(),
    };
  }

  get program(): ts.Program {
    return this.#program;
  }

  get typeChecker(): ts.TypeChecker {
    return this.#typeChecker;
  }

  get packageInfo(): PackageInfo {
    return (this.#packageInfo ??= new PackageInfo(
      JSON.parse(fs.readFileSync('package.json', 'utf-8')) as PackageJson,
    ));
  }

  get vfs(): TsVfs {
    return this.#vfs;
  }

  get tempDir(): string | undefined {
    return this.#tempDir;
  }

  get libs(): TsLibs {
    return this.#libs;
  }

  resolveSymbolAtLocation(node: ts.Node): ts.Symbol | undefined {
    const symbol = this.#typeChecker.getSymbolAtLocation(node);

    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      return this.#typeChecker.getAliasedSymbol(symbol);
    }

    return symbol;
  }

  async createTempDir(): Promise<string> {
    let { tempDir = this.program.getCompilerOptions().outDir } = this;

    if (tempDir) {
      tempDir = path.resolve(tempDir);
      await fsPromises.mkdir(tempDir, { recursive: true });
    } else {
      tempDir = path.resolve('node_modules');
    }

    return await fsPromises.mkdtemp(path.join(tempDir, 'uc-compiler-'));
  }

  reportErrors(diagnostics: readonly ts.Diagnostic[]): boolean {
    return reportTsErrors(this.#formatHost, diagnostics);
  }

}
