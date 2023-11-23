import { UcDeserializer } from 'churi';
import { EsNameRegistry } from 'esgen';
import { capitalize } from 'httongue';
import path from 'node:path';
import ts from 'typescript';
import { TsFileEditor } from './ts/ts-file-editor.js';
import { TsFileTransformer } from './ts/ts-file-transformer.js';
import { TsOptionsLiteral } from './ts/ts-options-literal.js';
import { TsRoot } from './ts/ts-root.js';
import { TsStatementTransformer } from './ts/ts-statement-transformer.js';
import { TsError } from './ts/ts.error.js';
import { UctBundleRegistry } from './uct-bundle-registry.js';
import { UctBundle } from './uct-bundle.js';
import { UctLib } from './uct-lib.js';
import { UctSetup } from './uct-setup.js';
import { UctTasks } from './uct-tasks.js';

export class UcTransformer {

  readonly #setup: UctSetup;
  readonly #tsRoot: TsRoot;
  readonly #bundleRegistry: UctBundleRegistry;
  readonly #tasks: UctTasks;

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
    try {
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
    } catch (error) {
      if (error instanceof TsError) {
        error.report(this.#setup);
      }

      throw error;
    }
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
      case churiExports.createUcBundle:
        return this.#configureBundle(node);
      case churiExports.createUcDeserializer:
        return this.#createDeserializer('deserializer', node, stTfm);
      case churiExports.createUcSerializer:
        return this.#createSerializer('serializer', node, stTfm);
    }

    return;
  }

  #configureBundle(node: ts.CallExpression): ts.Node {
    const constDecl = this.#setup.findConstDeclaration(node);
    const symbol = constDecl && this.#setup.resolveSymbolAtLocation(constDecl.name);

    if (!symbol) {
      throw new TsError(`Bundle expected to be declared as top-level constant`, {
        node,
      });
    }

    const bundle = this.#bundleRegistry.getBundle(symbol);
    const { options } = new TsOptionsLiteral(this.#setup, symbol.name, node.arguments[0]);

    bundle.configure({
      distFile: options.dist.getString(),
    });

    return node;
  }

  #createDeserializer(
    target: string,
    node: ts.CallExpression,
    stTfm: TsStatementTransformer,
  ): ts.Node {
    const compilerConfig = new TsOptionsLiteral(this.#setup, target, node.arguments[1]);
    const { options } = compilerConfig;
    const bundle = this.#bundleRegistry.resolveBundle(compilerConfig);
    const { replacement, fnId, modelId } = this.#extractModel(
      bundle,
      target,
      node,
      stTfm,
      'readValue',
    );

    this.#tasks.compileUcDeserializer({
      bundle,
      fnId,
      modelId,
      from: stTfm.sourceFile.fileName,
      mode: (options.mode?.getString() as UcDeserializer.Mode | undefined) ?? 'universal',
      byTokens: options.byTokens?.getBoolean() ?? false,
    });

    return replacement;
  }

  #createSerializer(
    target: string,
    node: ts.CallExpression,
    stTfm: TsStatementTransformer,
  ): ts.Node {
    const compilerConfig = new TsOptionsLiteral(this.#setup, target, node.arguments[1]);
    const bundle = this.#bundleRegistry.resolveBundle(compilerConfig);
    const { replacement, fnId, modelId } = this.#extractModel(
      bundle,
      target,
      node,
      stTfm,
      'writeValue',
    );

    this.#tasks.compileUcSerializer({
      bundle,
      fnId,
      modelId,
      from: stTfm.sourceFile.fileName,
    });

    return replacement;
  }

  #extractModel(
    bundle: UctBundle,
    target: string,
    node: ts.CallExpression,
    stTfm: TsStatementTransformer,
    suffix: string,
  ): {
    readonly replacement: ts.Node;
    readonly fnId: string;
    readonly modelId: ts.Identifier;
  } {
    const { factory, sourceFile, fileTfm, editor } = stTfm;
    const { modelId, fnId } = this.#createModelIds(target, node, stTfm, suffix);

    stTfm.addPrefix(
      factory.createVariableStatement(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(modelId, undefined, undefined, node.arguments[0])],
          ts.NodeFlags.Const,
        ),
      ),
    );

    const replacement = factory.createUniqueName(fnId);

    fileTfm.addImport(
      factory.createImportDeclaration(
        undefined,
        factory.createImportClause(
          false,
          undefined,
          factory.createNamedImports([
            factory.createImportSpecifier(false, factory.createIdentifier(fnId), replacement),
          ]),
        ),
        factory.createStringLiteral(
          path.relative(path.dirname(sourceFile.fileName), bundle.distFile),
          true,
        ),
      ),
    );

    editor.mapNode(node, () => factory.updateCallExpression(node, node.expression, node.typeArguments, [
        modelId,
        ...node.arguments.slice(1),
      ]));

    return { replacement, fnId, modelId };
  }

  #createModelIds(
    target: string,
    node: ts.CallExpression,
    stTfm: TsStatementTransformer,
    suggested: string,
  ): { modelId: ts.Identifier; fnId: string } {
    const constDecl = this.#setup.findConstDeclaration(node);
    const symbol = constDecl && this.#setup.resolveSymbolAtLocation(constDecl.name);

    if (!symbol) {
      throw new TsError(`${capitalize(target)} expected to be declared as top-level constant`, {
        node,
      });
    }

    const name = symbol.name;
    const fnId = name ?? this.#ns.reserveName(suggested);

    return {
      modelId: stTfm.factory.createIdentifier(UC_PREFIX + symbol.name + UC_MODEL_SUFFIX),
      fnId,
    };
  }

}

export interface UcTransformerInit {
  readonly setup: UctSetup;
  readonly tsRoot?: TsRoot | undefined;
  readonly bundleRegistry?: UctBundleRegistry | undefined;
  readonly tasks?: UctTasks | undefined;
}

const UC_PREFIX = '\u2c1f';
const UC_MODEL_SUFFIX = '$$uc$model';
