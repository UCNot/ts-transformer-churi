import ts from 'typescript';

export abstract class TsContextTransformer {
  readonly #context: ts.TransformationContext;

  constructor(context: ts.TransformationContext) {
    this.#context = context;
  }

  get context(): ts.TransformationContext {
    return this.#context;
  }

  get factory(): ts.NodeFactory {
    return this.context.factory;
  }
}
