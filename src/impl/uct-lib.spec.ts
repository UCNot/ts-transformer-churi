import { beforeEach, describe, expect, it } from '@jest/globals';
import path from 'node:path';
import ts from 'typescript';
import { transform } from '../spec/transform.js';
import { UcTransformer } from './uc-transformer.js';
import { UctLib } from './uct-lib.js';
import { UctSetup } from './uct-setup.js';

describe('UctLib', () => {
  let lib: UctLib;
  let createUcTransformer: (program: ts.Program) => UcTransformer;

  beforeEach(() => {
    createUcTransformer = program => {
      const setup = new UctSetup(program);

      lib = new UctLib(setup);

      return new UcTransformer(setup, lib);
    };
  });

  describe('emitCompilerSource', () => {
    it('emits nothing by default', async () => {
      transform(
        {
          'no-uc.ts': `
console.debug('none');
        `,
        },
        createUcTransformer,
      );

      await expect(lib.emitCompilerSource()).resolves.toBeUndefined();
    });
    it('emits deserializer compilation', async () => {
      transform(
        {
          'deserializer.ts': `
import { createUcDeserializer } from 'churi';

const readValue = createUcDeserializer(String);
        `,
        },
        createUcTransformer,
      );

      const { fileName, sourceText } = (await lib.emitCompilerSource())!;

      expect(fileName).toBe(path.resolve('src', 'spec', 'tests', 'uc-lib.compiler.ts'));
      expect(sourceText).toContain(` from './deserializer.js';`);
      expect(sourceText).toContain(`await compileDeserializers();`);
      expect(sourceText).not.toContain(`compileSerializers`);
    });
    it('emits serializer compilation', async () => {
      transform(
        {
          'serializer.ts': `
import { createUcSerializer } from 'churi';

const writeValue = createUcSerializer(String);
        `,
        },
        createUcTransformer,
      );

      const { fileName, sourceText } = (await lib.emitCompilerSource())!;

      expect(fileName).toBe(path.resolve('src', 'spec', 'tests', 'uc-lib.compiler.ts'));
      expect(sourceText).toContain(` from './serializer.js';`);
      expect(sourceText).toContain(`await compileSerializers();`);
      expect(sourceText).not.toContain(`compileDeserializers`);
    });
    it('emits serializer ans deserializer compilation', async () => {
      transform(
        {
          'model.ts': `
import { createUcDeserializer, createUcSerializer } from 'churi';

const readValue = createUcDeserializer(String);
const writeValue = createUcSerializer(String);
        `,
        },
        createUcTransformer,
      );

      const { fileName, sourceText } = (await lib.emitCompilerSource())!;

      expect(fileName).toBe(path.resolve('src', 'spec', 'tests', 'uc-lib.compiler.ts'));
      expect(sourceText).toContain(` from './model.js';`);
      expect(sourceText).toContain(`compileDeserializers(),`);
      expect(sourceText).toContain(`compileSerializers(),`);
    });
  });
});
