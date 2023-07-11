export abstract class TsContextTransformer {

  readonly #attrs = new Map<abstract new (...args: never[]) => unknown, unknown>();
  #enclosing: TsContextTransformer | undefined;

  constructor(enclosing?: TsContextTransformer) {
    this.#enclosing = enclosing;
  }

  getAttr<T>(key: abstract new (...args: never[]) => T): T | undefined {
    return (this.#attrs.get(key) as T | undefined) ?? this.#enclosing?.getAttr(key);
  }

  setAttr<T>(key: abstract new (...args: never[]) => T, value: T): void {
    this.#attrs.set(key, value);
  }

}
