import { PackageInfo } from '@run-z/npk';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { UcTransformerDistributive, UcTransformerOptions } from '../uc-transformer-options.js';
import { reportErrors } from './report-errors.js';

export class UctSetup implements UcTransformerOptions {

  readonly #program: ts.Program;
  readonly #dist: Required<UcTransformerDistributive>;
  readonly #tempDir: string | undefined;
  readonly #formatHost: ts.FormatDiagnosticsHost;

  constructor(
    program: ts.Program,
    { dist: { deserializer, serializer } = {}, tempDir }: UcTransformerOptions = {},
  ) {
    this.#program = program;

    if (!deserializer || !serializer) {
      const guessed = guessUctDist();

      deserializer ??= guessed.deserializer;
      serializer ??= guessed.serializer;
    }

    this.#dist = {
      deserializer,
      serializer,
    };

    this.#tempDir = tempDir;

    this.#formatHost = {
      getCurrentDirectory: program.getCurrentDirectory.bind(program),
      getNewLine: () => ts.sys.newLine,
      getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? f => f : f => f.toLowerCase(),
    };
  }

  get program(): ts.Program {
    return this.#program;
  }

  get dist(): Required<UcTransformerDistributive> {
    return this.#dist;
  }

  get tempDir(): string | undefined {
    return this.#tempDir;
  }

  async createTempDir(): Promise<string> {
    let { outDir } = this.program.getCompilerOptions();

    if (outDir) {
      await fs.mkdir(outDir, { recursive: true });
    } else {
      outDir = 'node_modules';
    }

    return await fs.mkdtemp(path.join(outDir, 'uc-compiler-'));
  }

  reportErrors(diagnostics: readonly ts.Diagnostic[]): boolean {
    return reportErrors(this.#formatHost, diagnostics);
  }

}

function guessUctDist(): Required<UcTransformerDistributive> {
  const { type, mainEntryPoint } = loadPackageInfo();

  const indexFile = mainEntryPoint?.findJs(type);
  let indexName: string;

  if (indexFile) {
    indexName = indexFile.slice(0, -path.extname(indexFile).length);
  } else {
    indexName = './index';
  }

  const ext = type === 'module' ? 'js' : 'mjs';

  return {
    deserializer: `${indexName}.ucd-lib.${ext}`,
    serializer: `${indexName}.ucs-lib.${ext}`,
  };
}

let packageInfo: PackageInfo | undefined;

function loadPackageInfo(): PackageInfo {
  return (packageInfo ??= PackageInfo.loadSync());
}
