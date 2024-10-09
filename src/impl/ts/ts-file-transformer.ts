import ts from 'typescript';
import { TsContextTransformer } from './ts-context-transformer.js';
import { TsFileEditor } from './ts-file-editor.js';

export class TsFileTransformer extends TsContextTransformer {
  readonly #editor: TsFileEditor;
  readonly #imports: ts.ImportDeclaration[] = [];

  constructor(editor: TsFileEditor) {
    super(editor.context);
    this.#editor = editor;
  }

  get sourceFile(): ts.SourceFile {
    return this.#editor.sourceFile;
  }

  get editor(): TsFileEditor {
    return this.#editor;
  }

  addImport(decl: ts.ImportDeclaration): void {
    this.#imports.push(decl);
  }

  transform(sourceFile: ts.SourceFile): ts.SourceFile {
    if (!this.#imports.length) {
      return sourceFile;
    }

    return this.factory.updateSourceFile(sourceFile, [...this.#imports, ...sourceFile.statements]);
  }
}
