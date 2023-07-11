import ts from 'typescript';
import { TsVfs } from './ts-vfs.js';

export interface TsInit {
  readonly program: ts.Program;
  readonly vfs?: TsVfs | undefined;
  readonly tempDir?: string | undefined;
}
