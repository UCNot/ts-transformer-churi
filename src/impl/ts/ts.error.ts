import ts from 'typescript';
import { TsSetup } from './ts-setup.js';

export class TsError extends Error {

  readonly #node: ts.Node;

  constructor(message: string, options: TsErrorOptions) {
    super(message, options);
    this.name = 'TsError';

    const { node } = options;

    this.#node = node;
  }

  get node(): ts.Node {
    return this.#node;
  }

  report(setup: TsSetup): void {
    const { message, node } = this;

    setup.reportErrors([setup.buildDiagnosticsForNode(node, message)]);
  }

}

export interface TsErrorOptions extends ErrorOptions {
  readonly node: ts.Node;
}
