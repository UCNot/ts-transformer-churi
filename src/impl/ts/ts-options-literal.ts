import ts from 'typescript';
import { TsSetup } from './ts-setup.js';
import { TsError } from './ts.error.js';

export class TsOptionsLiteral {

  readonly #setup: TsSetup;
  readonly #target: string;
  readonly #node: ts.ObjectLiteralExpression | undefined;
  readonly #options: { [name: string]: TsOptionValue } = {};

  constructor(setup: TsSetup, target: string, node?: ts.Expression) {
    if (node && !ts.isObjectLiteralExpression(node)) {
      throw new TsError(`${target} options have to be passed as object literal`, { node });
    }

    this.#setup = setup;
    this.#target = target;
    this.#node = node;

    if (node) {
      for (const option of node.properties) {
        if (
          !(
            ts.isPropertyAssignment(option)
            || ts.isShorthandPropertyAssignment(option)
            || ts.isMethodDeclaration(option)
          )
          || (!ts.isIdentifier(option.name) && !ts.isLiteralExpression(option.name))
        ) {
          throw new TsError(`Can not extract ${target} option`, { node: option });
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
  readonly #node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.MethodDeclaration;
  #name: string;

  constructor(
    options: TsOptionsLiteral,
    name: string,
    node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.MethodDeclaration,
  ) {
    this.#options = options;
    this.#name = name;
    this.#node = node;
  }

  get #valueNode(): ts.Node {
    const { node } = this;

    return ts.isPropertyAssignment(node) ? node.initializer : node.name;
  }

  get #initializer(): ts.Expression | undefined {
    const { node } = this;

    return ts.isPropertyAssignment(node) ? node.initializer : undefined;
  }

  get node(): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.MethodDeclaration {
    return this.#node;
  }

  getSymbol(): ts.Symbol | undefined {
    const symbol = this.#resolveSymbol();

    if (!symbol) {
      throw new TsError(`Can not resolve option ${this.#name} in ${this.#options.target}`, {
        node: this.#valueNode,
      });
    }

    return this.#isUndefined(symbol) ? undefined : symbol;
  }

  #resolveSymbol(): ts.Symbol | undefined {
    const { node } = this;
    const { setup } = this.#options;

    if (ts.isShorthandPropertyAssignment(node)) {
      return setup.typeChecker.getShorthandAssignmentValueSymbol(node);
    }

    const initializer = this.#initializer;

    return initializer && setup.resolveSymbolAtLocation(initializer);
  }

  #isUndefined(symbol: ts.Symbol): boolean {
    return this.#options.setup.typeChecker.isUndefinedSymbol(symbol);
  }

  getString(): string | undefined {
    const value = this.getValue();

    if (value === undefined || typeof value === 'string') {
      return value;
    }

    throw new TsError(
      `Value of option ${this.#name} in ${this.#options.target} expected to be a string constant`,
      { node: this.#valueNode },
    );
  }

  getBoolean(): boolean | undefined {
    const value = this.getValue();

    if (value === undefined || typeof value === 'boolean') {
      return value;
    }

    throw new TsError(
      `Value of option ${this.#name} in ${this.#options.target} expected to be a boolean constant`,
      { node: this.#valueNode },
    );
  }

  getValue(): string | number | boolean | null | undefined {
    const initializer = this.#initializer;

    if (initializer) {
      if (ts.isLiteralExpression(initializer)) {
        if (ts.isStringLiteralLike(initializer)) {
          return initializer.text;
        }
        if (ts.isNumericLiteral(initializer)) {
          return Number(initializer.text);
        }
      }

      switch (initializer.kind) {
        case ts.SyntaxKind.TrueKeyword:
          return true;
        case ts.SyntaxKind.FalseKeyword:
          return false;
        case ts.SyntaxKind.NullKeyword:
          return null;
        default:
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
    }

    throw new TsError(`Can not resolve value of option ${this.#name} in ${this.#options.target}`, {
      node: this.#valueNode,
    });
  }

}
