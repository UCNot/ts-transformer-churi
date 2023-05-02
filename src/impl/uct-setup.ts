import { PackageInfo } from '@run-z/npk';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { UcTransformerOptions } from '../uc-transformer-options.js';
import { reportErrors } from './report-errors.js';
import { UctVfs } from './uct-vfs.js';

export class UctSetup implements UcTransformerOptions {

  readonly #program: ts.Program;
  readonly #dist: string;
  readonly #tempDir: string | undefined;
  readonly #vfs: UctVfs;
  readonly #formatHost: ts.FormatDiagnosticsHost;

  constructor(
    program: ts.Program,
    vfs: UctVfs = {},
    { dist = guessUctDist(), tempDir }: UcTransformerOptions = {},
  ) {
    this.#program = program;
    this.#dist = dist;
    this.#tempDir = tempDir;
    this.#vfs = vfs;

    this.#formatHost = {
      getCurrentDirectory: program.getCurrentDirectory.bind(program),
      getNewLine: () => ts.sys.newLine,
      getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? f => f : f => f.toLowerCase(),
    };
  }

  get program(): ts.Program {
    return this.#program;
  }

  get dist(): string {
    return this.#dist;
  }

  get tempDir(): string | undefined {
    return this.#tempDir;
  }

  get vfs(): UctVfs {
    return this.#vfs;
  }

  async createTempDir(): Promise<string> {
    let { tempDir = this.program.getCompilerOptions().outDir } = this;

    if (tempDir) {
      tempDir = path.resolve(tempDir);
      await fs.mkdir(tempDir, { recursive: true });
    } else {
      tempDir = path.resolve('node_modules');
    }

    return await fs.mkdtemp(path.join(tempDir, 'uc-compiler-'));
  }

  reportErrors(diagnostics: readonly ts.Diagnostic[]): boolean {
    return reportErrors(this.#formatHost, diagnostics);
  }

}

function guessUctDist(): string {
  const { type, mainEntryPoint } = loadPackageInfo();

  const indexFile = mainEntryPoint?.findJs(type);
  let indexName: string;

  if (indexFile) {
    indexName = indexFile.slice(0, -path.extname(indexFile).length);
  } else {
    indexName = './index';
  }

  const ext = type === 'module' ? 'js' : 'mjs';

  return `${indexName}.uc-lib.${ext}`;
}

let packageInfo: PackageInfo | undefined;

function loadPackageInfo(): PackageInfo {
  return (packageInfo ??= PackageInfo.loadSync());
}
