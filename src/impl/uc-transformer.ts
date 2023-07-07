import { EsNameRegistry } from 'esgen';
import path from 'node:path';
import ts from 'typescript';
import { ChuriLib } from './churi-lib.js';
import { TsFileEditor } from './ts-file-editor.js';
import { TsFileTransformer } from './ts-file-transformer.js';
import { UctLib } from './uct-lib.js';
import { UctSetup } from './uct-setup.js';
import { UctTasks } from './uct-tasks.js';

export class UcTransformer {

  readonly #typeChecker: ts.TypeChecker;
  readonly #dist: string;
  #tasks: UctTasks;

  readonly #ns = new EsNameRegistry();
  readonly #churi: ChuriLib;

  constructor(setup: UctSetup, tasks: UctTasks = new UctLib(setup)) {
    const { program, dist } = setup;

    this.#typeChecker = program.getTypeChecker();
    this.#dist = dist;
    this.#churi = new ChuriLib(this.#typeChecker);
    this.#tasks = tasks;
  }

  createTransformerFactory(): ts.TransformerFactory<ts.SourceFile> {
    return context => sourceFile => this.#transformSourceFile(sourceFile, context);
  }

  #transformSourceFile(
    sourceFile: ts.SourceFile,
    context: ts.TransformationContext,
  ): ts.SourceFile {
    const editor = new TsFileEditor(sourceFile, context);
    const fileTfm = new TsFileTransformer(editor);
    let result = ts.visitNode(sourceFile, node => this.#transform(node, fileTfm)) as ts.SourceFile;

    result = fileTfm.transform(result);
    if (result !== sourceFile) {
      this.#tasks.replaceSourceFile(editor.emitFile());
    }

    return result;
  }

  #transform(node: ts.Node, fileTfm: TsFileTransformer): ts.Node | ts.Node[] {
    if (ts.isStatement(node)) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        this.#importOrExport(node);

        return node;
      }

      return this.#statement(node, fileTfm);
    }

    return this.#each(node, fileTfm);
  }

  #each<TNode extends ts.Node>(node: TNode, fileTfm: TsFileTransformer): TNode {
    return ts.visitEachChild(node, node => this.#transform(node, fileTfm), fileTfm.context);
  }

  #statement(statement: ts.Statement, fileTfm: TsFileTransformer): ts.Node {
    const prefix: ts.Statement[] = [];
    const stContext: StatementContext = {
      fileTfm,
      statement,
      prefix,
    };

    const result = ts.visitEachChild(
      statement,
      node => this.#transformExpression(node, stContext),
      fileTfm.context,
    );

    if (prefix.length) {
      const { editor } = fileTfm;

      editor.mapNode(statement, () => [...prefix, editor.emitNode(statement)]);
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
      context.fileTfm.editor.context,
    );
  }

  #importOrExport(node: ts.ImportDeclaration | ts.ExportDeclaration): void {
    this.#churi.onImportOrExport(node);
  }

  #call(node: ts.CallExpression, context: StatementContext): ts.Node | undefined {
    const churiExports = this.#churi.exports;

    if (!churiExports) {
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
      case churiExports.createUcDeserializer:
        return this.#createDeserializer(node, context);
      case churiExports.createUcSerializer:
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
      from: context.fileTfm.editor.sourceFile.fileName,
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
      from: context.fileTfm.editor.sourceFile.fileName,
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
    const { fileTfm } = context;
    const { sourceFile, factory, editor } = fileTfm;
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

    fileTfm.addImport(
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

    editor.mapNode(node, () => factory.updateCallExpression(node, node.expression, node.typeArguments, [
        modelId,
        ...node.arguments.slice(1),
      ]));

    return { replacement: fnAlias, fnId, modelId };
  }

  #createIds(
    { parent }: ts.CallExpression,
    { fileTfm }: StatementContext,
    suggested: string,
  ): { modelId: ts.Identifier; fnId: string } {
    const {
      editor: {
        context: { factory },
      },
    } = fileTfm;

    if (ts.isVariableDeclaration(parent)) {
      const { name } = parent;

      if (ts.isIdentifier(name)) {
        return {
          modelId: factory.createIdentifier(UC_MODEL_PREFIX + name.text + UC_MODEL_SUFFIX),
          fnId: this.#ns.reserveName(name.text),
        };
      }
    }

    return {
      modelId: factory.createIdentifier(UC_MODEL_PREFIX + UC_MODEL_SUFFIX),
      fnId: this.#ns.reserveName(suggested),
    };
  }

}

const UC_MODEL_PREFIX = '\u2c1f';
const UC_MODEL_SUFFIX = '$$uc$model';

interface StatementContext {
  readonly fileTfm: TsFileTransformer;
  readonly statement: ts.Statement;
  readonly prefix: ts.Statement[];
}
