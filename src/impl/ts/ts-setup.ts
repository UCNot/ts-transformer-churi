import { PackageInfo, PackageJson } from '@run-z/npk';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { ChuriTsLib } from './churi.ts-lib.js';
import { reportTsErrors } from './report-ts-errors.js';
import { TsInit } from './ts-init.js';
import { TsLibs } from './ts-libs.js';
import { TsVfs } from './ts-vfs.js';

export class TsSetup {
  readonly #program: ts.Program;
  readonly #typeChecker: ts.TypeChecker;
  readonly #vfs: TsVfs;
  readonly #tempDir: string | undefined;
  readonly #libs: TsLibs;
  readonly #formatHost: ts.FormatDiagnosticsHost;
  #packageInfo?: PackageInfo;

  constructor({ program, vfs = {}, tempDir }: TsInit) {
    this.#program = program;
    this.#typeChecker = program.getTypeChecker();
    this.#vfs = vfs;
    this.#tempDir = tempDir;
    this.#libs = {
      churi: new ChuriTsLib(this),
    };
    this.#formatHost = {
      getCurrentDirectory: program.getCurrentDirectory.bind(program),
      getNewLine: () => ts.sys.newLine,
      getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? f => f : f => f.toLowerCase(),
    };
  }

  get program(): ts.Program {
    return this.#program;
  }

  get typeChecker(): ts.TypeChecker {
    return this.#typeChecker;
  }

  get packageInfo(): PackageInfo {
    return (this.#packageInfo ??= new PackageInfo(
      JSON.parse(fs.readFileSync('package.json', 'utf-8')) as PackageJson,
    ));
  }

  get vfs(): TsVfs {
    return this.#vfs;
  }

  get tempDir(): string | undefined {
    return this.#tempDir;
  }

  get libs(): TsLibs {
    return this.#libs;
  }

  getSourceFile(node: ts.Node): ts.SourceFile {
    return ts.isSourceFile(node) ? node : this.getSourceFile(node.parent);
  }

  buildDiagnosticsForNode(node: ts.Node, messageText: string): ts.DiagnosticWithLocation {
    const file = this.getSourceFile(node);

    return {
      category: ts.DiagnosticCategory.Error,
      code: 9999,
      source: file.fileName,
      file,
      start: node.pos,
      length: node.end - node.pos,
      messageText,
    };
  }

  findConstDeclaration(node: ts.Node): ts.VariableDeclaration | undefined {
    const { parent } = node;

    if (!parent) {
      return;
    }
    if (ts.isVariableDeclaration(parent)) {
      const varDeclList = parent.parent;
      const varStatement = varDeclList?.parent;

      return ts.isVariableDeclarationList(varDeclList) &&
        ts.isVariableStatement(varStatement) &&
        varDeclList.flags & ts.NodeFlags.Const &&
        ts.isSourceFile(varStatement.parent)
        ? parent
        : undefined;
    }
    if (ts.isParenthesizedExpression(parent)) {
      return this.findConstDeclaration(parent.parent);
    }

    return;
  }

  guessName(node: ts.Node): string | undefined {
    if (ts.isIdentifier(node)) {
      return node.text;
    }
    if (ts.isVariableDeclaration(node)) {
      const symbol = this.#typeChecker.getSymbolAtLocation(node.name);

      return symbol && symbol.name;
    }
    if (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) {
      const { name } = node;

      if (ts.isComputedPropertyName(name)) {
        const { expression } = name;

        if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) {
          return expression.text;
        }

        return;
      }

      return name.text;
    }
    if (ts.isExpression(node)) {
      return this.guessName(node.parent);
    }

    return;
  }

  resolveSymbolAtLocation(node: ts.Node): ts.Symbol | undefined {
    const symbol = this.#typeChecker.getSymbolAtLocation(node);

    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      return this.#typeChecker.getAliasedSymbol(symbol);
    }

    return symbol;
  }

  relativeImport(relativeTo: string, modulePath: string): string {
    const moduleName = modulePath.endsWith('ts')
      ? modulePath.slice(0, -2) + 'js'
      : modulePath.endsWith('tsx')
        ? modulePath.slice(0, -3) + '.js'
        : modulePath;

    const result = path.relative(relativeTo, moduleName);
    const moduleSpec = result.replaceAll(path.sep, '/');

    if (!moduleSpec.startsWith('./') && !moduleSpec.startsWith('../')) {
      return './' + moduleSpec;
    }

    return moduleSpec;
  }

  async createTempDir(): Promise<string> {
    let { tempDir = this.program.getCompilerOptions().outDir } = this;

    if (tempDir) {
      tempDir = path.resolve(tempDir);
      await fsPromises.mkdir(tempDir, { recursive: true });
    } else {
      tempDir = path.resolve('node_modules');
    }

    return await fsPromises.mkdtemp(path.join(tempDir, 'uc-compiler-'));
  }

  reportErrors(diagnostics: readonly ts.Diagnostic[]): boolean {
    return reportTsErrors(this.#formatHost, diagnostics);
  }
}
