import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { transform } from '../spec/transform.js';
import { TsVfs } from './ts/ts-vfs.js';
import { UcTransformer } from './uc-transformer.js';
import { UctLib } from './uct-lib.js';
import { UctSetup } from './uct-setup.js';

describe('UctLib', () => {
  let lib: UctLib;
  let createUcTransformer: (program: ts.Program, vfs: TsVfs) => UcTransformer;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp('target/test-');
    createUcTransformer = (program, vfs) => {
      const setup = new UctSetup({
        program,
        vfs,
        dist: `${testDir}/test.uc-lib.js`,
        tempDir: testDir,
      });

      lib = new UctLib(setup);

      return new UcTransformer(setup, lib);
    };
  });
  afterEach(async () => {
    await fs.rm(testDir, { recursive: true });
  });

  describe('emitBundler', () => {
    it('emits nothing by default', async () => {
      transform(
        {
          'no-uc.ts': `
console.debug('none');
        `,
        },
        createUcTransformer,
      );

      await expect(lib.emitBundler()).resolves.toBeUndefined();
    });
    it('emits deserializer bundler', async () => {
      transform(
        {
          'deserializer.ts': `
import { createUcDeserializer } from 'churi';

export const readValue = createUcDeserializer(String);
        `,
        },
        createUcTransformer,
      );

      const { fileName, sourceText } = (await lib.emitBundler())!;

      expect(fileName).toBe(path.resolve('src', 'spec', 'tests', 'uc-lib.bundler.ts'));
      expect(sourceText).toContain(` from './deserializer.js';`);
      expect(sourceText).toContain(`test.uc-lib.js`);
      expect(sourceText).toContain(`await emitBundle();`);
    });
    it('emits serializer bundler', async () => {
      transform(
        {
          'serializer.ts': `
import { createUcSerializer } from 'churi';

export const writeValue = createUcSerializer(String);
        `,
        },
        createUcTransformer,
      );

      const { fileName, sourceText } = (await lib.emitBundler())!;

      expect(fileName).toBe(path.resolve('src', 'spec', 'tests', 'uc-lib.bundler.ts'));
      expect(sourceText).toContain(` from './serializer.js';`);
      expect(sourceText).toContain(`test.uc-lib.js`);
      expect(sourceText).toContain(`await emitBundle();`);
    });
    it('emits serializer and deserializer bundler', async () => {
      transform(
        {
          'model.ts': `
import { createUcDeserializer, createUcSerializer } from 'churi';

export const readValue = createUcDeserializer(String);
export const writeValue = createUcSerializer(String);
        `,
        },
        createUcTransformer,
      );

      const { fileName, sourceText } = (await lib.emitBundler())!;

      expect(fileName).toBe(path.resolve('src', 'spec', 'tests', 'uc-lib.bundler.ts'));
      expect(sourceText).toContain(` from './model.js';`);
      expect(sourceText).toContain(`test.uc-lib.js`);
      expect(sourceText).toContain(`await emitBundle();`);
    });
  });

  describe('compile', () => {
    it('emits deserializer lib', async () => {
      transform(
        {
          'deserializer.ts': `
import { createUcDeserializer } from 'churi';

export const readValue = createUcDeserializer(String);
        `,
        },
        createUcTransformer,
      );

      await lib.compile();

      const file = await fs.readFile(`${testDir}/test.uc-lib.js`, 'utf-8');

      expect(file).toContain('export function readValue(');
    });
    it('emits serializer lib', async () => {
      transform(
        {
          'serializer.ts': `
import { createUcSerializer } from 'churi';

export const writeValue = createUcSerializer(String);
        `,
        },
        createUcTransformer,
      );

      await lib.compile();

      const file = await fs.readFile(`${testDir}/test.uc-lib.js`, 'utf-8');

      expect(file).toContain('export async function writeValue(');
    });
    it('emits serializer and deserializer lib', async () => {
      transform(
        {
          'model.ts': `
import { createUcDeserializer, createUcSerializer } from 'churi';

export const readValue = createUcDeserializer(String);
export const writeValue = createUcSerializer(String);
        `,
        },
        createUcTransformer,
      );

      await lib.compile();

      const file = await fs.readFile(`${testDir}/test.uc-lib.js`, 'utf-8');

      expect(file).toContain('export function readValue(');
      expect(file).toContain('export async function writeValue(');
    });
    it('emits multiple libs', async () => {
      transform(
        {
          'model.ts': `
import { createUcBundle, createUcDeserializer, createUcSerializer } from 'churi';

export const readString = createUcDeserializer(String);
export const { writeString } = createUcBundle({
  dist: './custom.uc-lib.js',
  bundle() {
    return {
      writeString: createUcSerializer(String),
    };
  },
});
        `,
        },
        createUcTransformer,
      );

      await lib.compile();

      const file1 = await fs.readFile(`${testDir}/test.uc-lib.js`, 'utf-8');
      const file2 = await fs.readFile(`${testDir}/custom.uc-lib.js`, 'utf-8');

      expect(file1).toContain('export function readString(');
      expect(file1).not.toContain('export async function writeString(');

      expect(file2).not.toContain('export function readString(');
      expect(file2).toContain('export async function writeString(');
    });
  });
});
