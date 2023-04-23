import { PackageInfo } from '@run-z/npk';
import path from 'node:path';
import ts from 'typescript';
import { UcTransformerOptions } from '../uc-transformer-options.js';

export class UctSetup {

  readonly #program: ts.Program;
  readonly #distFile: string;

  constructor(program: ts.Program, { distFile = guessUctDistFile() }: UcTransformerOptions = {}) {
    this.#program = program;
    this.#distFile = distFile;
  }

  get program(): ts.Program {
    return this.#program;
  }

  get distFile(): string {
    return this.#distFile;
  }

}

function guessUctDistFile(): string {
  const { type, mainEntryPoint } = loadPackageInfo();

  const indexFile = mainEntryPoint?.findJs(type);
  let indexName: string;

  if (indexFile) {
    indexName = indexFile.slice(0, -path.extname(indexFile).length);
  } else {
    indexName = './index';
  }

  return indexName + (type === 'module' ? '.uc-lib.js' : '.uc-lib.mjs');
}

let packageInfo: PackageInfo | undefined;

function loadPackageInfo(): PackageInfo {
  return (packageInfo ??= PackageInfo.loadSync());
}
