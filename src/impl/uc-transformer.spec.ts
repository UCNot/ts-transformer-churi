import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import ts from 'typescript';
import { transform } from '../spec/transform.js';
import { UcTransformer } from './uc-transformer.js';
import { UctCompilerTasks } from './uct-compiler.js';

describe('UcTransformer', () => {
  let tasks: jest.Mocked<UctCompilerTasks>;
  let createUcTransformer: (program: ts.Program) => UcTransformer;

  beforeEach(() => {
    tasks = {
      compileUcDeserializer: jest.fn(),
      compileUcSerializer: jest.fn(),
    };
    createUcTransformer = program => new UcTransformer(program, tasks);
  });

  it('discovers serializer', () => {
    transform(
      {
        'create-serializer.ts': `
import { createUcSerializer } from 'churi';

export const writeNumber = createUcSerializer(Number);
`,
      },
      createUcTransformer,
    );

    expect(tasks.compileUcSerializer).toHaveBeenCalledTimes(1);
  });
  it('discovers serializer via imports', () => {
    transform(
      {
        'create-serializer-via-import.ts': `
import { createSerializer } from './test-imports.js';

export const writeNumber = createSerializer(Number);
    `,
        'test-imports.ts': `
export { createUcSerializer as createSerializer } from 'churi';
`,
      },
      createUcTransformer,
    );

    expect(tasks.compileUcSerializer).toHaveBeenCalledTimes(1);
  });
  it('discovers deserializer via alias', () => {
    transform(
      {
        'create-deserializer-via-alias.ts': `
import { createUcDeserializer as createDeserializer } from 'churi';

export const readNumber = createDeserializer(Number);
`,
      },
      createUcTransformer,
    );

    expect(tasks.compileUcDeserializer).toHaveBeenCalledTimes(1);
  });
});
