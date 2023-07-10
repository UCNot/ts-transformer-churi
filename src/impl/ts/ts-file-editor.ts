import { lazyValue } from '@proc7ts/primitives';
import ts from 'typescript';

export class TsFileEditor {

  readonly #sourceFile: ts.SourceFile;
  readonly #context: ts.TransformationContext;
  readonly #mappings = new Map<ts.Node, () => ts.Node | ts.Node[]>();

  constructor(sourceFile: ts.SourceFile, context: ts.TransformationContext) {
    this.#sourceFile = sourceFile;
    this.#context = context;
  }

  get sourceFile(): ts.SourceFile {
    return this.#sourceFile;
  }

  get context(): ts.TransformationContext {
    return this.#context;
  }

  mapNode(node: ts.Node, mapping: () => ts.Node | ts.Node[]): void {
    this.#mappings.set(node, lazyValue(mapping));
  }

  emitNode<TNode extends ts.Node>(node: TNode): TNode {
    const mapped = ts.visitEachChild(
      node,
      node => {
        const to = this.#mappings.get(node);

        if (to) {
          return to();
        }

        return this.emitNode(node);
      },
      this.#context,
    );

    if (mapped !== node) {
      this.#mappings.set(node, () => mapped);
    }

    return mapped;
  }

  emitFile(): ts.SourceFile {
    return ts.visitNode(this.#sourceFile, node => this.emitNode(node)) as ts.SourceFile;
  }

}
