import ts from 'typescript';
import { UcTransformer } from './impl/uc-transformer.js';

export type * from './uc-transformer-options.js';

export default function createUcTransformer(
  program: ts.Program,
): ts.TransformerFactory<ts.SourceFile> {
  return new UcTransformer(program).createTransformerFactory();
}
