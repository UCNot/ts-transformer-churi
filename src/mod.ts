import ts from 'typescript';
import { UcTransformer } from './impl/uc-transformer.js';

export default function createUcTransformer(
  program: ts.Program,
): ts.TransformerFactory<ts.SourceFile> {
  return new UcTransformer(program).createTransformerFactory();
}
