import ts from 'typescript';
import { UcCompiler, UcCompilerTasks } from './uc-compiler.js';

export class UcTransformer {

  readonly #typeChecker: ts.TypeChecker;
  readonly #tasks: UcCompilerTasks;
  #churiExports?: ChuriExports;

  constructor(program: ts.Program, tasks: UcCompilerTasks = new UcCompiler()) {
    this.#typeChecker = program.getTypeChecker();
    this.#tasks = tasks;
  }

  createTransformerFactory(): ts.TransformerFactory<ts.SourceFile> {
    return context => sourceFile => this.#transformSourceFile(sourceFile, context);
  }

  #transformSourceFile(
    sourceFile: ts.SourceFile,
    context: ts.TransformationContext,
  ): ts.SourceFile {
    return ts.visitNode(sourceFile, node => this.#transform(node, context)) as ts.SourceFile;
  }

  #transform(node: ts.Node, context: ts.TransformationContext): ts.Node {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      this.#importOrExport(node);

      return node;
    }
    if (ts.isCallExpression(node)) {
      return this.#call(node) ?? this.#each(node, context);
    }

    return this.#each(node, context);
  }

  #each<TNode extends ts.Node>(node: TNode, context: ts.TransformationContext): TNode {
    return ts.visitEachChild(node, node => this.#transform(node, context), context);
  }

  #importOrExport(node: ts.ImportDeclaration | ts.ExportDeclaration): void {
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
    if (this.#churiExports) {
      return;
    }

    const moduleSymbol = this.#typeChecker.getSymbolAtLocation(node)!;

    this.#churiExports = {
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

  #call(node: ts.CallExpression): ts.CallExpression | undefined {
    if (!this.#churiExports) {
      // No imports from `churi` yet.
      return;
    }

    let callee = this.#typeChecker.getSymbolAtLocation(node.expression);

    if (!callee) {
      // Callee is not a symbol
      return;
    }

    if (callee.flags & ts.SymbolFlags.Alias) {
      callee = this.#typeChecker.getAliasedSymbol(callee);
    }

    switch (callee) {
      case this.#churiExports.createUcDeserializer:
        return this.#createDeserializer(node);
      case this.#churiExports.createUcSerializer:
        return this.#createSerializer(node);
    }

    return;
  }

  #createDeserializer(node: ts.CallExpression): ts.CallExpression {
    this.#tasks.compileUcDeserializer();

    return node;
  }

  #createSerializer(node: ts.CallExpression): ts.CallExpression {
    this.#tasks.compileUcSerializer();

    return node;
  }

}

interface ChuriExports {
  readonly createUcDeserializer: ts.Symbol;
  readonly createUcSerializer: ts.Symbol;
}
