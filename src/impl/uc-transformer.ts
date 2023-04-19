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

  #transform(node: ts.Node, context: ts.TransformationContext): ts.Node | ts.Node[] {
    if (ts.isStatement(node)) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        this.#importOrExport(node);

        return node;
      }

      return this.#statement(node, context);
    }

    return this.#each(node, context);
  }

  #each<TNode extends ts.Node>(node: TNode, context: ts.TransformationContext): TNode {
    return ts.visitEachChild(node, node => this.#transform(node, context), context);
  }

  #statement(statement: ts.Statement, context: ts.TransformationContext): ts.Node | ts.Node[] {
    const stContext: StatementContext = {
      context,
      statement,
    };

    const result = ts.visitEachChild(
      statement,
      node => this.#transformExpression(node, stContext),
      context,
    );
    const { prefix } = stContext;

    return prefix ? [...prefix, result] : result;
  }

  #transformExpression(node: ts.Node, context: StatementContext): ts.Node {
    if (ts.isCallExpression(node)) {
      return this.#call(node, context) ?? this.#eachExpression(node, context);
    }

    return this.#eachExpression(node, context);
  }

  #eachExpression(node: ts.Node, context: StatementContext): ts.Node {
    return ts.visitEachChild(
      node,
      node => this.#transformExpression(node, context),
      context.context,
    );
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

  #call(node: ts.CallExpression, context: StatementContext): ts.Node | undefined {
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
        return this.#createDeserializer(node, context);
      case this.#churiExports.createUcSerializer:
        return this.#createSerializer(node, context);
    }

    return;
  }

  #createDeserializer(node: ts.CallExpression, context: StatementContext): ts.Node {
    this.#tasks.compileUcDeserializer();

    return this.#extractModel(node, context);
  }

  #createSerializer(node: ts.CallExpression, context: StatementContext): ts.Node {
    this.#tasks.compileUcSerializer();

    return this.#extractModel(node, context);
  }

  #extractModel(node: ts.CallExpression, context: StatementContext): ts.Node {
    const { factory } = context.context;
    const { parent } = node;
    let modelId: ts.Identifier | undefined;

    if (ts.isVariableDeclaration(parent)) {
      const { name } = parent;

      if (ts.isIdentifier(name)) {
        modelId = factory.createUniqueName(name.text + UC_MODEL_SUFFIX);
      }
    }

    modelId ??= factory.createUniqueName(UC_MODEL_SUFFIX);

    const modelDecl = factory.createVariableStatement(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      factory.createVariableDeclarationList(
        [factory.createVariableDeclaration(modelId, undefined, undefined, node.arguments[0])],
        ts.NodeFlags.Const,
      ),
    );

    context.prefix = [modelDecl];

    return factory.updateCallExpression(node, node.expression, node.typeArguments, [modelId]);
  }

}

const UC_MODEL_SUFFIX = '$$uc$model';

interface ChuriExports {
  readonly createUcDeserializer: ts.Symbol;
  readonly createUcSerializer: ts.Symbol;
}

interface StatementContext {
  readonly context: ts.TransformationContext;
  readonly statement: ts.Statement;
  prefix?: ts.Statement[];
}
