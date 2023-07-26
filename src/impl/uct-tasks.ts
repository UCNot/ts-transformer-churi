import { UcDeserializer, UcFormatName } from 'churi';
import ts from 'typescript';
import { UctBundle } from './uct-bundle.js';

export interface UctTasks {
  replaceSourceFile(sourceFile: ts.SourceFile): void;
  compileUcDeserializer(task: UctCompileDeserializerFn): void;
  compileUcSerializer(task: UctCompileSerializerFn): void;
}

export interface UctCompileDeserializerFn {
  readonly bundle: UctBundle;
  readonly fnId: string;
  readonly modelId: ts.Identifier;
  readonly from: string;
  readonly mode: UcDeserializer.Mode;
  readonly format: UcFormatName | 'tokens';
}

export interface UctCompileSerializerFn {
  readonly bundle: UctBundle;
  readonly fnId: string;
  readonly modelId: ts.Identifier;
  readonly from: string;
}
