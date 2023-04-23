import { PackageInfo } from '@run-z/npk';
import path from 'node:path';
import ts from 'typescript';
import { UcTransformerDistributive, UcTransformerOptions } from '../uc-transformer-options.js';

export class UctSetup implements UcTransformerOptions {

  readonly #program: ts.Program;
  readonly #dist: Required<UcTransformerDistributive>;

  constructor(
    program: ts.Program,
    { dist: { deserializer, serializer } = {} }: UcTransformerOptions = {},
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
  }

  get program(): ts.Program {
    return this.#program;
  }

  get dist(): Required<UcTransformerDistributive> {
    return this.#dist;
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
