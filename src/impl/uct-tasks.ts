import ts from 'typescript';

export interface UctTasks {
  replaceSourceFile(sourceFile: ts.SourceFile): void;
  compileUcDeserializer(task: UctCompileFn): void;
  compileUcSerializer(task: UctCompileFn): void;
}

export interface UctCompileFn {
  readonly fnId: string;
  readonly modelId: ts.Identifier;
  readonly from: string;
}
