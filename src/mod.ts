import ts from 'typescript';
import { UcTransformer } from './impl/uc-transformer.js';
import { UcTransformerOptions } from './uc-transformer-options.js';

export type * from './uc-transformer-options.js';

export default function createUcTransformer(
  program: ts.Program,
  options?: UcTransformerOptions,
): ts.TransformerFactory<ts.SourceFile> {
  return new UcTransformer(program, undefined, options).createTransformerFactory();
}
