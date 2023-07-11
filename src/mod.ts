import ts from 'typescript';
import { UcTransformer } from './impl/uc-transformer.js';
import { UctLib } from './impl/uct-lib.js';
import { UctSetup } from './impl/uct-setup.js';
import { UcTransformerOptions } from './uc-transformer-options.js';

export type * from './uc-transformer-options.js';

export default function createUcTransformer(
  program: ts.Program,
  options?: UcTransformerOptions,
): ts.TransformerFactory<ts.SourceFile> {
  const setup = new UctSetup({ program, ...options });

  return new UcTransformer(setup, new UctLib(setup)).createTransformerFactory();
}
