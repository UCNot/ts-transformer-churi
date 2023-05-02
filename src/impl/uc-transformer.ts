import { UccNamespace } from 'churi/compiler.js';
import path from 'node:path';
import ts from 'typescript';
import { TsNodeMapper } from './ts-node-mapper.js';
import { UctLib } from './uct-lib.js';
import { UctSetup } from './uct-setup.js';
import { UctTasks } from './uct-tasks.js';

export class UcTransformer {

  readonly #typeChecker: ts.TypeChecker;
  readonly #dist: string;
  #tasks: UctTasks;

  readonly #ns = new UccNamespace();
  #churiExports?: ChuriExports;

  constructor(setup: UctSetup, tasks: UctTasks = new UctLib(setup)) {
    const { program, dist } = setup;

    this.#typeChecker = program.getTypeChecker();
    this.#dist = dist;
    this.#tasks = tasks;
  }

  createTransformerFactory(): ts.TransformerFactory<ts.SourceFile> {
    return context => sourceFile => this.#transformSourceFile(sourceFile, context);
  }

  #transformSourceFile(
    sourceFile: ts.SourceFile,
    context: ts.TransformationContext,
  ): ts.SourceFile {
    const imports: ts.ImportDeclaration[] = [];
    const mapper = new TsNodeMapper(sourceFile, context);
    const srcContext: SourceFileContext = {
      context,
      sourceFile,
      imports,
      mapper,
    };
    const { factory } = context;

    let result = ts.visitNode(sourceFile, node => this.#transform(node, srcContext)) as ts.SourceFile;

    if (imports.length) {
      result = factory.updateSourceFile(result, [...imports, ...result.statements]);
    }
    if (result !== sourceFile) {
      this.#tasks.replaceSourceFile(mapper.updateAll());
    }

    return result;
  }

  #transform(node: ts.Node, srcContext: SourceFileContext): ts.Node | ts.Node[] {
    if (ts.isStatement(node)) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        this.#importOrExport(node);

        return node;
      }

      return this.#statement(node, srcContext);
    }

    return this.#each(node, srcContext);
  }

  #each<TNode extends ts.Node>(node: TNode, srcContext: SourceFileContext): TNode {
    return ts.visitEachChild(node, node => this.#transform(node, srcContext), srcContext.context);
  }

  #statement(statement: ts.Statement, srcContext: SourceFileContext): ts.Node {
    const prefix: ts.Statement[] = [];
    const stContext: StatementContext = {
      srcContext,
      statement,
      prefix,
    };

    const result = ts.visitEachChild(
      statement,
      node => this.#transformExpression(node, stContext),
      srcContext.context,
    );

    if (prefix.length) {
      const { mapper } = srcContext;

      mapper.addMapping(statement, () => [...prefix, mapper.updateNode(statement)]);
    }

    return result;
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
      context.srcContext.context,
    );
  }

  #importOrExport(node: ts.ImportDeclaration | ts.ExportDeclaration): void {
    if (this.#churiExports) {
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
    if (!node.arguments.length) {
      // Model argument required.
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
    const { replacement, fnId, modelId } = this.#extractModel(
      node,
      context,
      this.#dist,
      'readValue',
    );

    this.#tasks.compileUcDeserializer({
      fnId,
      modelId,
      from: context.srcContext.sourceFile.fileName,
    });

    return replacement;
  }

  #createSerializer(node: ts.CallExpression, context: StatementContext): ts.Node {
    const { replacement, fnId, modelId } = this.#extractModel(
      node,
      context,
      this.#dist,
      'writeValue',
    );

    this.#tasks.compileUcSerializer({
      fnId,
      modelId,
      from: context.srcContext.sourceFile.fileName,
    });

    return replacement;
  }

  #extractModel(
    node: ts.CallExpression,
    context: StatementContext,
    distFile: string,
    suffix: string,
  ): {
    readonly replacement: ts.Node;
    readonly fnId: string;
    readonly modelId: ts.Identifier;
  } {
    const { srcContext } = context;
    const {
      sourceFile,
      context: { factory },
      mapper,
    } = srcContext;
    const { modelId, fnId } = this.#createIds(node, context, suffix);

    context.prefix.push(
      factory.createVariableStatement(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(modelId, undefined, undefined, node.arguments[0])],
          ts.NodeFlags.Const,
        ),
      ),
    );

    const fnAlias = factory.createUniqueName(fnId);

    srcContext.imports.push(
      factory.createImportDeclaration(
        undefined,
        factory.createImportClause(
          false,
          undefined,
          factory.createNamedImports([
            factory.createImportSpecifier(false, factory.createIdentifier(fnId), fnAlias),
          ]),
        ),
        factory.createStringLiteral(path.relative(path.dirname(sourceFile.fileName), distFile)),
      ),
    );

    mapper.addMapping(node, () => factory.updateCallExpression(node, node.expression, node.typeArguments, [
        modelId,
        ...node.arguments.slice(1),
      ]));

    return { replacement: fnAlias, fnId, modelId };
  }

  #createIds(
    { parent }: ts.CallExpression,
    { srcContext }: StatementContext,
    suggested: string,
  ): { modelId: ts.Identifier; fnId: string } {
    const {
      context: { factory },
    } = srcContext;

    if (ts.isVariableDeclaration(parent)) {
      const { name } = parent;

      if (ts.isIdentifier(name)) {
        return {
          modelId: factory.createIdentifier(name.text + UC_MODEL_SUFFIX),
          fnId: this.#ns.name(name.text),
        };
      }
    }

    return { modelId: factory.createIdentifier(UC_MODEL_SUFFIX), fnId: this.#ns.name(suggested) };
  }

}

const UC_MODEL_SUFFIX = '$$uc$model';

interface ChuriExports {
  readonly createUcDeserializer: ts.Symbol;
  readonly createUcSerializer: ts.Symbol;
}

interface SourceFileContext {
  readonly context: ts.TransformationContext;
  readonly sourceFile: ts.SourceFile;
  readonly imports: ts.ImportDeclaration[];
  readonly mapper: TsNodeMapper;
}

interface StatementContext {
  readonly srcContext: SourceFileContext;
  readonly statement: ts.Statement;
  readonly prefix: ts.Statement[];
}
