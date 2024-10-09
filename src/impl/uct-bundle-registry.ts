import { EsNameRegistry } from 'esgen';
import { hyphenate } from 'httongue';
import path from 'node:path';
import ts from 'typescript';
import { TsOptionsLiteral } from './ts/ts-options-literal.js';
import { UctBundle } from './uct-bundle.js';
import { UctSetup } from './uct-setup.js';

export class UctBundleRegistry {
  readonly #ns = new EsNameRegistry();
  readonly #setup: UctSetup;
  #defaultBundle?: UctBundle;
  readonly #bundles = new Map<ts.Symbol, UctBundle>();

  constructor(setup: UctSetup) {
    this.#setup = setup;
  }

  get defaultBundle(): UctBundle {
    return (this.#defaultBundle ??= this.#createDefaultBundle());
  }

  #createDefaultBundle(): UctBundle {
    const { dist = this.#guessUctDist() } = this.#setup;

    return new UctBundle(this.#setup, dist);
  }

  getBundle(symbol: ts.Symbol): UctBundle {
    const found = this.#bundles.get(symbol);

    if (found) {
      return found;
    }

    const newBundle = new UctBundle(this.#setup, this.#guessUctDist(hyphenate(symbol.name)));

    this.#bundles.set(symbol, newBundle);

    return newBundle;
  }

  resolveBundle({ options: { bundle } }: TsOptionsLiteral): UctBundle {
    const symbol = bundle?.getSymbol();

    return symbol ? this.getBundle(symbol) : this.defaultBundle;
  }

  *bundles(): IterableIterator<UctBundle> {
    if (this.#defaultBundle) {
      yield this.#defaultBundle;
    }
    yield* this.#bundles.values();
  }

  #guessUctDist(bundleName?: string): string {
    if (!bundleName) {
      bundleName = this.#ns.reserveName('bundle');
      if (bundleName === 'bundle') {
        bundleName = undefined;
      }
    }

    const { type, mainEntryPoint } = this.#setup.packageInfo;
    const indexFile = mainEntryPoint?.findJs(type);
    let indexName: string;

    if (indexFile) {
      indexName = indexFile.slice(0, -path.extname(indexFile).length);
    } else {
      indexName = './index';
    }

    const ext = type === 'module' ? 'js' : 'mjs';

    return `${indexName}.${bundleName ? bundleName + '.' : ''}uc-lib.${ext}`;
  }
}
