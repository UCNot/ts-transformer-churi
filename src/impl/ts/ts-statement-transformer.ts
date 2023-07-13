import ts from 'typescript';
import { TsContextTransformer } from './ts-context-transformer.js';
import { TsFileEditor } from './ts-file-editor.js';
import { TsFileTransformer } from './ts-file-transformer.js';

export class TsStatementTransformer extends TsContextTransformer {

  readonly #prefix: ts.Statement[] = [];

  constructor(readonly fileTfm: TsFileTransformer, readonly statement: ts.Statement) {
    super(fileTfm.context);
    this.fileTfm = fileTfm;
  }

  get sourceFile(): ts.SourceFile {
    return this.fileTfm.sourceFile;
  }

  get editor(): TsFileEditor {
    return this.fileTfm.editor;
  }

  addPrefix(prefix: ts.Statement): void {
    this.#prefix.push(prefix);
  }

  transform(): void {
    if (this.#prefix.length) {
      const { editor, statement } = this;

      this.editor.mapNode(statement, () => [...this.#prefix, editor.emitNode(statement)]);
    }
  }

}
