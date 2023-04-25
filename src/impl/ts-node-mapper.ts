import ts from 'typescript';

export class TsNodeMapper {

  readonly #sourceFile: ts.SourceFile;
  readonly #context: ts.TransformationContext;
  readonly #mappings = new Map<ts.Node, () => ts.Node | ts.Node[]>();

  constructor(sourceFile: ts.SourceFile, context: ts.TransformationContext) {
    this.#sourceFile = sourceFile;
    this.#context = context;
  }

  addMapping(node: ts.Node, mapping: () => ts.Node | ts.Node[]): void {
    this.#mappings.set(node, mapping);
  }

  updateAll(): ts.SourceFile {
    return ts.visitNode(this.#sourceFile, node => this.updateNode(node)) as ts.SourceFile;
  }

  updateNode<TNode extends ts.Node>(node: TNode): TNode {
    return ts.visitEachChild(
      node,
      node => {
        const to = this.#mappings.get(node);

        if (to) {
          return to();
        }

        return this.updateNode(node);
      },
      this.#context,
    );
  }

}
