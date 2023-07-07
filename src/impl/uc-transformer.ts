import { EsNameRegistry } from 'esgen';
import path from 'node:path';
import ts from 'typescript';
import { ChuriLib } from './churi-lib.js';
import { TsFileEditor } from './ts-file-editor.js';
import { TsFileTransformer } from './ts-file-transformer.js';
import { TsStatementTransformer } from './ts-statement-transformer.js';
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
    const stTfm = new TsStatementTransformer(fileTfm, statement);
    const result = ts.visitEachChild(
      statement,
      node => this.#transformExpression(node, stTfm),
      fileTfm.context,
    );

    stTfm.transform(); // Call only _after_ transformation.

    return result;
  }

  #transformExpression(node: ts.Node, stTfm: TsStatementTransformer): ts.Node {
    if (ts.isCallExpression(node)) {
      return this.#call(node, stTfm) ?? this.#eachExpression(node, stTfm);
    }

    return this.#eachExpression(node, stTfm);
  }

  #eachExpression(node: ts.Node, stTfm: TsStatementTransformer): ts.Node {
    return ts.visitEachChild(node, node => this.#transformExpression(node, stTfm), stTfm.context);
  }

  #importOrExport(node: ts.ImportDeclaration | ts.ExportDeclaration): void {
    this.#churi.onImportOrExport(node);
  }

  #call(node: ts.CallExpression, stTfm: TsStatementTransformer): ts.Node | undefined {
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
        return this.#createDeserializer(node, stTfm);
      case churiExports.createUcSerializer:
        return this.#createSerializer(node, stTfm);
    }

    return;
  }

  #createDeserializer(node: ts.CallExpression, stTfm: TsStatementTransformer): ts.Node {
    const { replacement, fnId, modelId } = this.#extractModel(node, stTfm, this.#dist, 'readValue');

    this.#tasks.compileUcDeserializer({
      fnId,
      modelId,
      from: stTfm.fileTfm.editor.sourceFile.fileName,
    });

    return replacement;
  }

  #createSerializer(node: ts.CallExpression, stTfm: TsStatementTransformer): ts.Node {
    const { replacement, fnId, modelId } = this.#extractModel(
      node,
      stTfm,
      this.#dist,
      'writeValue',
    );

    this.#tasks.compileUcSerializer({
      fnId,
      modelId,
      from: stTfm.fileTfm.editor.sourceFile.fileName,
    });

    return replacement;
  }

  #extractModel(
    node: ts.CallExpression,
    stTfm: TsStatementTransformer,
    distFile: string,
    suffix: string,
  ): {
    readonly replacement: ts.Node;
    readonly fnId: string;
    readonly modelId: ts.Identifier;
  } {
    const { factory, sourceFile, fileTfm, editor } = stTfm;
    const { modelId, fnId } = this.#createIds(node, stTfm, suffix);

    stTfm.addPrefix(
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
    { factory }: TsStatementTransformer,
    suggested: string,
  ): { modelId: ts.Identifier; fnId: string } {
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
