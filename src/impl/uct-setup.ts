import { UcTransformerOptions } from '../uc-transformer-options.js';
import { TsRoot } from './ts/ts-root.js';
import { TsSetup } from './ts/ts-setup.js';
import { UctBundleRegistry } from './uct-bundle-registry.js';
import { UctInit } from './uct-init.js';

export class UctSetup extends TsSetup implements UcTransformerOptions {
  readonly #tsRoot: TsRoot;
  readonly #bundleRegistry: UctBundleRegistry;

  readonly #dist: string | undefined;

  constructor(init: UctInit) {
    super(init);

    const { dist } = init;

    this.#tsRoot = new TsRoot();
    this.#bundleRegistry = new UctBundleRegistry(this);
    this.#dist = dist;
  }

  get tsRoot(): TsRoot {
    return this.#tsRoot;
  }

  get bundleRegistry(): UctBundleRegistry {
    return this.#bundleRegistry;
  }

  get dist(): string | undefined {
    return this.#dist;
  }
}
