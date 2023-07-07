import ts from 'typescript';

export class ChuriLib {

  readonly #typeChecker: ts.TypeChecker;
  #exports?: ChuriLibExports;

  constructor(typeChecker: ts.TypeChecker) {
    this.#typeChecker = typeChecker;
  }

  get exports(): ChuriLibExports | undefined {
    return this.#exports;
  }

  onImportOrExport(node: ts.ImportDeclaration | ts.ExportDeclaration): void {
    if (this.#exports) {
      return; // No need to inspect further.
    }

    const { moduleSpecifier } = node;

    if (this.#isChuriSpecifier(moduleSpecifier)) {
      this.#referChuri(moduleSpecifier);
    }
  }

  #isChuriSpecifier(
    node: ts.Expression | ts.ExportSpecifier | undefined,
  ): node is ts.StringLiteral {
    return !!node && ts.isStringLiteral(node) && node.text === 'churi';
  }

  #referChuri(node: ts.Expression | ts.ExportSpecifier): void {
    const moduleSymbol = this.#typeChecker.getSymbolAtLocation(node)!;

    this.#exports = {
      createUcDeserializer: this.#typeChecker.tryGetMemberInModuleExports(
        'createUcDeserializer',
        moduleSymbol,
      )!,
      createUcSerializer: this.#typeChecker.tryGetMemberInModuleExports(
        'createUcSerializer',
        moduleSymbol,
      )!,
    };
  }

}

export interface ChuriLibExports {
  readonly createUcDeserializer: ts.Symbol;
  readonly createUcSerializer: ts.Symbol;
}
