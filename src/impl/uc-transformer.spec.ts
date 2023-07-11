import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import ts from 'typescript';
import { transform } from '../spec/transform.js';
import { TsVfs } from './ts/ts-vfs.js';
import { UcTransformer } from './uc-transformer.js';
import { UctSetup } from './uct-setup.js';
import { UctTasks } from './uct-tasks.js';

describe('UcTransformer', () => {
  let setup: UctSetup;
  let tasks: jest.Mocked<UctTasks>;
  let createUcTransformer: (program: ts.Program, vfs: TsVfs) => UcTransformer;

  beforeEach(() => {
    tasks = {
      replaceSourceFile: jest.fn(),
      compileUcDeserializer: jest.fn(),
      compileUcSerializer: jest.fn(),
    };
    createUcTransformer = (program, vfs) => new UcTransformer((setup = new UctSetup({ program, vfs })), tasks);
  });

  it('discovers serializer', () => {
    const output = transform(
      {
        'create-serializer.ts': `
import { createUcSerializer } from 'churi';

export const writeNumber = createUcSerializer(Number);
`,
      },
      createUcTransformer,
    );

    expect(tasks.compileUcSerializer).toHaveBeenCalledTimes(1);
    expect(tasks.compileUcSerializer.mock.calls[0][0].bundle).toBe(
      setup.bundleRegistry.defaultBundle,
    );
    expect(output).toContain('.uc-lib.js');
  });
  it('discovers serializer via imports', () => {
    const output = transform(
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
    expect(tasks.compileUcSerializer.mock.calls[0][0].bundle).toBe(
      setup.bundleRegistry.defaultBundle,
    );
    expect(output).toContain('.uc-lib.js');
  });
  it('discovers deserializer via alias', () => {
    const output = transform(
      {
        'create-deserializer-via-alias.ts': `
import { createUcDeserializer as createDeserializer } from 'churi';

export const readNumber = createDeserializer(Number);
`,
      },
      createUcTransformer,
    );

    expect(tasks.compileUcDeserializer).toHaveBeenCalledTimes(1);
    expect(tasks.compileUcDeserializer.mock.calls[0][0].bundle).toBe(
      setup.bundleRegistry.defaultBundle,
    );
    expect(output).toContain('.uc-lib.js');
  });

  describe('bundle', () => {
    it('discovers serializer within bundle', () => {
      const output = transform(
        {
          'create-serializer.ts': `
  import { createUcBundle, createUcSerializer } from 'churi';

  export const { writeNumber } = createUcBundle({
    dist: 'custom-bundle.js',
    bundle() {
      return {
        writeNumber: createUcSerializer(Number),
      };
    },
  });
  `,
        },
        createUcTransformer,
      );

      expect(tasks.compileUcSerializer).toHaveBeenCalledTimes(1);

      const { bundle } = tasks.compileUcSerializer.mock.calls[0][0];

      expect(bundle).not.toBe(setup.bundleRegistry.defaultBundle);
      expect(bundle.distFile).toContain('custom-bundle.js');
      expect(output).toContain('/dist/custom-bundle.js');
    });
  });
});
