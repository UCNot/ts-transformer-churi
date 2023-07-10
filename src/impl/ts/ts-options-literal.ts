import ts from 'typescript';
import { TsSetup } from './ts-setup.js';

export class TsOptionsLiteral {

  readonly #setup: TsSetup;
  readonly #target: string;
  readonly #node: ts.ObjectLiteralExpression | undefined;
  readonly #options: { [name: string]: TsOptionValue } = {};

  constructor(setup: TsSetup, target: string, node?: ts.Node) {
    if (node && !ts.isObjectLiteralExpression(node)) {
      throw new Error(`${target} options have to be passed as object literal`);
    }

    this.#setup = setup;
    this.#target = target;
    this.#node = node;

    if (node) {
      for (const option of node.properties) {
        if (
          !ts.isPropertyAssignment(option)
          || (!ts.isIdentifier(option.name) && !ts.isLiteralExpression(option.name))
        ) {
          throw new Error(`Can not extract ${target} option`);
        }

        const name = option.name.text;

        this.#options[name] = new TsOptionValue(this, name, option);
      }
    }
  }

  get setup(): TsSetup {
    return this.#setup;
  }

  get target(): string {
    return this.#target;
  }

  get node(): ts.ObjectLiteralExpression | undefined {
    return this.#node;
  }

  get options(): { readonly [name: string]: TsOptionValue } {
    return this.#options;
  }

}

export class TsOptionValue {

  readonly #options: TsOptionsLiteral;
  readonly #node: ts.PropertyAssignment;
  #name: string;

  constructor(options: TsOptionsLiteral, name: string, node: ts.PropertyAssignment) {
    this.#options = options;
    this.#name = name;
    this.#node = node;
  }

  getSymbol(): ts.Symbol | undefined {
    const symbol = this.#resolveSymbol();

    if (!symbol) {
      throw new Error(`Can not resolve option ${this.#name} in ${this.#options.target}`);
    }

    return this.#isUndefined(symbol) ? undefined : symbol;
  }

  #resolveSymbol(): ts.Symbol | undefined {
    const { setup } = this.#options;

    return setup.resolveSymbolAtLocation(this.#node.initializer);
  }

  #isUndefined(symbol: ts.Symbol): boolean {
    return this.#options.setup.typeChecker.isUndefinedSymbol(symbol);
  }

  getString(): string | undefined {
    const value = this.getValue();

    if (value === undefined || typeof value === 'string') {
      return value;
    }

    throw new Error(
      `Value of option ${this.#name} in ${this.#options.target} expected to be a string constant`,
    );
  }

  getValue(): string | number | undefined {
    const { initializer } = this.#node;

    if (ts.isStringLiteralLike(initializer)) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const getValue = new Function(`return ${initializer.text};`);

      return getValue();
    }
    if (ts.isNumericLiteral(initializer)) {
      return Number(initializer.text);
    }

    const {
      setup: { typeChecker },
    } = this.#options;

    if (
      ts.isPropertyAccessExpression(initializer)
      || ts.isElementAccessExpression(initializer)
      || ts.isEnumMember(initializer)
    ) {
      const value = typeChecker.getConstantValue(initializer);

      if (value !== undefined) {
        return value;
      }
    } else {
      const symbol = this.#resolveSymbol();

      if (symbol && this.#isUndefined(symbol)) {
        return undefined;
      }
    }

    throw new Error(`Can not resolve value of option ${this.#name} in ${this.#options.target}`);
  }

}
