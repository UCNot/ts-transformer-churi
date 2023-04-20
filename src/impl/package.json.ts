import module from 'node:module';
import path from 'node:path';

export class PackageJson {

  static #instance?: PackageJson;

  static load(): PackageJson {
    if (this.#instance) {
      return this.#instance;
    }

    const requireModule = module.createRequire(import.meta.url);

    return (this.#instance = new PackageJson(
      requireModule(path.resolve('./package.json')) as PackageJson.Raw,
    ));
  }

  readonly #raw: PackageJson.Raw;
  #entries?: ReadonlyMap<PackageJson.EntryPath, PackageJson.EntryPoint>;
  #mainEntry?: PackageJson.EntryPoint;

  constructor(raw: PackageJson.Raw) {
    this.#raw = raw;
  }

  get raw(): PackageJson.Raw {
    return this.#raw;
  }

  get entries(): ReadonlyMap<PackageJson.EntryPath, PackageJson.EntryPoint> {
    return (this.#entries ??= this.#buildEntryPoints());
  }

  get mainEntry(): PackageJson.EntryPoint | undefined {
    return (this.#mainEntry ??= this.entries.get('.'));
  }

  #buildEntryPoints(): ReadonlyMap<PackageJson.EntryPath, PackageJson.EntryPoint> {
    const items = new Map<PackageJson.EntryPath, PackageJson$ExportItem[]>();

    for (const item of this.#listExports()) {
      const found = items.get(item.path);

      if (found) {
        found.push(item);
      } else {
        items.set(item.path, [item]);
      }
    }

    return new Map(
      [...items].map(([path, items]) => [path, new PackageJson$EntryPoint(path, items)]),
    );
  }

  *#listExports(): IterableIterator<PackageJson$ExportItem> {
    const { exports, main } = this.raw;

    if (!exports) {
      if (!main) {
        return;
      }

      yield {
        path: '.',
        conditions: [],
        target: main.startsWith('./') ? (main as `./${string}`) : `./${main}`,
      };

      return;
    }

    yield* this.#condExports([], exports);
  }

  *#condExports(
    conditions: readonly string[],
    exports: PackageJson.TopConditionalExports | PackageJson.PathExports | `./${string}`,
  ): IterableIterator<PackageJson$ExportItem> {
    if (typeof exports === 'string') {
      yield { path: '.', conditions, target: exports };

      return;
    }

    for (const [key, entry] of Object.entries(exports)) {
      if (isPathExport(key)) {
        yield* this.#pathExports(key, conditions, entry);
      } else {
        yield* this.#condExports([...conditions, key], entry);
      }
    }
  }

  *#pathExports(
    path: PackageJson.EntryPath,
    conditions: readonly string[],
    exports: PackageJson.ConditionalExports | `./${string}`,
  ): IterableIterator<PackageJson$ExportItem> {
    if (typeof exports === 'string') {
      yield { path, conditions, target: exports };

      return;
    }

    for (const [key, entry] of Object.entries(exports)) {
      yield* this.#pathExports(path, [...conditions, key], entry);
    }
  }

}

export namespace PackageJson {
  export interface Raw {
    readonly name?: string;
    readonly version?: string;
    readonly type?: 'module' | 'commonjs';
    readonly exports?: PackageJson.Exports;
    readonly main?: string;
    readonly dependencies?: PackageJson.Dependencies;
    readonly devDependencies?: PackageJson.Dependencies;
    readonly peerDependencies?: PackageJson.Dependencies;
    readonly optionalDependencies?: PackageJson.Dependencies;
    readonly [key: string]: unknown;
  }

  /**
   * Entry corresponding to package
   * [entry point](https://nodejs.org/dist/latest/docs/api/packages.html#package-entry-points) within `package.json`.
   */
  export interface EntryPoint {
    /**
     * Exported path or pattern.
     */
    readonly path: EntryPath;

    /**
     * Searches for path or pattern matching all provided conditions.
     *
     * @param conditions - Required export conditions. When missing, searches for `default` one.
     *
     * @returns Matching path or pattern, or `undefined` when not found.
     */
    findConditional(...conditions: string[]): `./${string}` | undefined;
  }

  export type EntryPath = '.' | `./${string}`;

  export type Dependencies = {
    readonly [name in string]: string;
  };

  export type Exports = PathExports | TopConditionalExports | `./${string}`;

  export type PathExports = {
    readonly [key in PackageJson.EntryPath]: ConditionalExports | `./${string}`;
  };

  export type ConditionalExports = {
    readonly [key in string]: ConditionalExports | `./${string}`;
  };

  export type TopConditionalExports = {
    readonly [key in string]: TopConditionalExports | PathExports | `./${string}`;
  };
}

class PackageJson$EntryPoint implements PackageJson.EntryPoint {

  readonly #path: PackageJson.EntryPath;
  #targetsByCondition = new Map<string, Set<`./${string}`>>();

  constructor(path: PackageJson.EntryPath, items: readonly PackageJson$ExportItem[]) {
    this.#path = path;

    for (const { conditions, target } of items) {
      for (const condition of conditions.length ? conditions : ['default']) {
        let targets = this.#targetsByCondition.get(condition);

        if (!targets) {
          targets = new Set();
          this.#targetsByCondition.set(condition, targets);
        }

        targets.add(target);
      }
    }
  }

  get path(): PackageJson.EntryPath {
    return this.#path;
  }

  findConditional(...conditions: string[]): `./${string}` | undefined {
    if (!conditions.length) {
      conditions = ['default'];
    }

    let candidates: Set<`./${string}`> | undefined;

    for (const condition of conditions.length ? conditions : ['default']) {
      const matching = this.#targetsByCondition.get(condition);

      if (!matching) {
        return;
      }

      if (!candidates) {
        candidates = new Set(matching);
      } else {
        for (const match of matching) {
          if (!candidates.has(match)) {
            candidates.delete(match);
          }
        }

        if (!candidates.size) {
          return;
        }
      }
    }

    if (!candidates?.size) {
      return;
    }

    return candidates.values().next().value;
  }

}

interface PackageJson$ExportItem {
  readonly path: PackageJson.EntryPath;
  readonly conditions: readonly string[];
  readonly target: `./${string}`;
}

function isPathExport(key: string): key is '.' | './${string' {
  return key.startsWith('.');
}
