import path from 'node:path';
import ts from 'typescript';
import { UcTransformerOptions } from '../uc-transformer-options.js';
import { guessDistFile } from './guess-dist-file.js';
import { UcCompiler, UcCompilerTasks } from './uc-compiler.js';

export class UcTransformer {

  readonly #typeChecker: ts.TypeChecker;
  readonly #tasks: UcCompilerTasks;
  readonly #reservedIds = new Set<string>();
  #churiExports?: ChuriExports;
  #distFile: string;

  constructor(
    program: ts.Program,
    tasks: UcCompilerTasks = new UcCompiler(),
    { distFile = guessDistFile() }: UcTransformerOptions = {},
  ) {
    this.#typeChecker = program.getTypeChecker();
    this.#tasks = tasks;
    this.#distFile = distFile;
  }

  createTransformerFactory(): ts.TransformerFactory<ts.SourceFile> {
    return context => sourceFile => this.#transformSourceFile(sourceFile, context);
  }

  #transformSourceFile(
    sourceFile: ts.SourceFile,
    context: ts.TransformationContext,
  ): ts.SourceFile {
    const imports: ts.ImportDeclaration[] = [];
    const srcContext: SourceFileContext = {
      context,
      sourceFile,
      imports,
    };

    const result = ts.visitNode(sourceFile, node => this.#transform(node, srcContext)) as ts.SourceFile;

    if (!imports.length) {
      return result;
    }

    const { factory } = context;

    return factory.updateSourceFile(result, [...imports, ...result.statements]);
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

  #statement(statement: ts.Statement, srcContext: SourceFileContext): ts.Node | ts.Node[] {
    const stContext: StatementContext = {
      srcContext,
      statement,
      prefix: [],
    };

    const result = ts.visitEachChild(
      statement,
      node => this.#transformExpression(node, stContext),
      srcContext.context,
    );

    return [...stContext.prefix, result];
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
    this.#tasks.compileUcDeserializer();

    return this.#extractModel(node, context, 'readValue');
  }

  #createSerializer(node: ts.CallExpression, context: StatementContext): ts.Node {
    this.#tasks.compileUcSerializer();

    return this.#extractModel(node, context, 'writeValue');
  }

  #extractModel(node: ts.CallExpression, context: StatementContext, suffix: string): ts.Node {
    const { srcContext } = context;
    const {
      sourceFile,
      context: { factory },
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
        factory.createStringLiteral(
          path.relative(path.dirname(sourceFile.fileName), this.#distFile),
        ),
      ),
    );

    return fnAlias;
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
          modelId: factory.createUniqueName(name.text + UC_MODEL_SUFFIX),
          fnId: this.#reserveId(name.text),
        };
      }
    }

    return { modelId: factory.createUniqueName(UC_MODEL_SUFFIX), fnId: this.#reserveId(suggested) };
  }

  #reserveId(suggested: string): string {
    if (!this.#reservedIds.has(suggested)) {
      this.#reservedIds.add(suggested);

      return suggested;
    }

    for (let i = 1; ; ++i) {
      const id = `${suggested}$${i}`;

      if (!this.#reservedIds.has(id)) {
        this.#reservedIds.add(id);

        return id;
      }
    }
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
}

interface StatementContext {
  readonly srcContext: SourceFileContext;
  readonly statement: ts.Statement;
  readonly prefix: ts.Statement[];
}
