import ts from 'typescript';
import { TsSetup } from './ts-setup.js';

export class ChuriTsLib {
  readonly #typeChecker: ts.TypeChecker;
  #exports?: ChuriLibExports;

  constructor({ typeChecker }: TsSetup) {
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

    if (this.#isLibSpecifier(moduleSpecifier)) {
      this.#refer(moduleSpecifier);
    }
  }

  #isLibSpecifier(node: ts.Expression | ts.ExportSpecifier | undefined): node is ts.StringLiteral {
    return !!node && ts.isStringLiteral(node) && node.text === 'churi';
  }

  #refer(moduleSpecifier: ts.Expression | ts.ExportSpecifier): void {
    const moduleSymbol = this.#typeChecker.getSymbolAtLocation(moduleSpecifier)!;

    this.#exports = {
      createUcBundle: this.#typeChecker.tryGetMemberInModuleExports(
        'createUcBundle',
        moduleSymbol,
      )!,
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
  readonly createUcBundle: ts.Symbol;
  readonly createUcDeserializer: ts.Symbol;
  readonly createUcSerializer: ts.Symbol;
}
