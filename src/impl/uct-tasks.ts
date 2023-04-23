import ts from 'typescript';

export interface UctTasks {
  compileUcDeserializer(task: UctCompileFn): void;
  compileUcSerializer(task: UctCompileFn): void;
}

export interface UctCompileFn {
  readonly fnId: string;
  readonly modelId: string;
  readonly from: ts.SourceFile;
}
