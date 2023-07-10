import { UcDeserializer } from 'churi';
import { EsNameRegistry } from 'esgen';
import path from 'node:path';
import ts from 'typescript';
import { TsFileEditor } from './ts/ts-file-editor.js';
import { TsFileTransformer } from './ts/ts-file-transformer.js';
import { TsOptionsLiteral } from './ts/ts-options-literal.js';
import { TsRoot } from './ts/ts-root.js';
import { TsStatementTransformer } from './ts/ts-statement-transformer.js';
import { UctBundleRegistry } from './uct-bundle-registry.js';
import { UctBundle } from './uct-bundle.js';
import { UctLib } from './uct-lib.js';
import { UctSetup } from './uct-setup.js';
import { UctTasks } from './uct-tasks.js';

export class UcTransformer {

  readonly #setup: UctSetup;
  readonly #tsRoot: TsRoot;
  readonly #bundleRegistry: UctBundleRegistry;
  #tasks: UctTasks;

  readonly #ns = new EsNameRegistry();

  constructor(setup: UctSetup, tasks: UctTasks = new UctLib(setup)) {
    const { tsRoot, bundleRegistry } = setup;

    this.#setup = setup;
    this.#tsRoot = tsRoot;
    this.#bundleRegistry = bundleRegistry;
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
      const emittedFile = editor.emitFile();

      this.#tsRoot.updateRootDir(emittedFile);
      this.#tasks.replaceSourceFile(emittedFile);
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
    this.#setup.libs.churi.onImportOrExport(node);
  }

  #call(node: ts.CallExpression, stTfm: TsStatementTransformer): ts.Node | undefined {
    const churiExports = this.#setup.libs.churi.exports;

    if (!churiExports) {
      // No imports from `churi` yet.
      return;
    }
    if (!node.arguments.length) {
      // Model argument required.
      return;
    }

    const callee = this.#setup.resolveSymbolAtLocation(node.expression);

    if (!callee) {
      // Callee is not a symbol
      return;
    }

    switch (callee) {
      case churiExports.createUcDeserializer:
        return this.#createDeserializer(callee, node, stTfm);
      case churiExports.createUcSerializer:
        return this.#createSerializer(callee, node, stTfm);
    }

    return;
  }

  #createDeserializer(
    callee: ts.Symbol,
    node: ts.CallExpression,
    stTfm: TsStatementTransformer,
  ): ts.Node {
    const options = this.#extractCompilerOptions(callee, node);
    const bundle = this.#bundleRegistry.resolveBundle(options);
    const { replacement, fnId, modelId } = this.#extractModel(bundle, node, stTfm, 'readValue');

    this.#tasks.compileUcDeserializer({
      bundle: bundle,
      fnId,
      modelId,
      from: stTfm.sourceFile.fileName,
      mode: (options.options.mode?.getString() as UcDeserializer.Mode) ?? 'universal',
    });

    return replacement;
  }

  #createSerializer(
    callee: ts.Symbol,
    node: ts.CallExpression,
    stTfm: TsStatementTransformer,
  ): ts.Node {
    const options = this.#extractCompilerOptions(callee, node);
    const bundle = this.#bundleRegistry.resolveBundle(options);
    const { replacement, fnId, modelId } = this.#extractModel(bundle, node, stTfm, 'writeValue');

    this.#tasks.compileUcSerializer({
      bundle,
      fnId,
      modelId,
      from: stTfm.sourceFile.fileName,
    });

    return replacement;
  }

  #extractCompilerOptions(callee: ts.Symbol, node: ts.CallExpression): TsOptionsLiteral {
    return new TsOptionsLiteral(
      this.#setup,
      callee.name,
      node.arguments.length > 1 ? node.arguments[1] : undefined,
    );
  }

  #extractModel(
    bundle: UctBundle,
    node: ts.CallExpression,
    stTfm: TsStatementTransformer,
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
        factory.createStringLiteral(
          path.relative(path.dirname(sourceFile.fileName), bundle.distFile),
        ),
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

export interface UcTransformerInit {
  readonly setup: UctSetup;
  readonly tsRoot?: TsRoot | undefined;
  readonly bundleRegistry?: UctBundleRegistry | undefined;
  readonly tasks?: UctTasks | undefined;
}

const UC_MODEL_PREFIX = '\u2c1f';
const UC_MODEL_SUFFIX = '$$uc$model';
