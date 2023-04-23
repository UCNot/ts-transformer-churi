import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import ts from 'typescript';
import { transform } from '../spec/transform.js';
import { UcTransformer } from './uc-transformer.js';
import { UctSetup } from './uct-setup.js';
import { UctTasks } from './uct-tasks.js';

describe('UcTransformer', () => {
  let tasks: jest.Mocked<UctTasks>;
  let createUcTransformer: (program: ts.Program) => UcTransformer;

  beforeEach(() => {
    tasks = {
      compileUcDeserializer: jest.fn(),
      compileUcSerializer: jest.fn(),
    };
    createUcTransformer = program => new UcTransformer(new UctSetup(program), tasks);
  });

  it('discovers serializer', () => {
    const sourceText = transform(
      {
        'create-serializer.ts': `
import { createUcSerializer } from 'churi';

export const writeNumber = createUcSerializer(Number);
`,
      },
      createUcTransformer,
    );

    expect(tasks.compileUcSerializer).toHaveBeenCalledTimes(1);
    expect(sourceText).toContain('.ucs-lib.js');
  });
  it('discovers serializer via imports', () => {
    const sourceText = transform(
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
    expect(sourceText).toContain('.ucs-lib.js');
  });
  it('discovers deserializer via alias', () => {
    const sourceText = transform(
      {
        'create-deserializer-via-alias.ts': `
import { createUcDeserializer as createDeserializer } from 'churi';

export const readNumber = createDeserializer(Number);
`,
      },
      createUcTransformer,
    );

    expect(tasks.compileUcDeserializer).toHaveBeenCalledTimes(1);
    expect(sourceText).toContain('.ucd-lib.js');
  });
});
