import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import ts from 'typescript';
import { transform } from '../spec/transform.js';
import { UcCompilerTasks } from './uc-compiler.js';
import { UcTransformer } from './uc-transformer.js';

describe('UcTransformer', () => {
  let tasks: jest.Mocked<UcCompilerTasks>;
  let createUcTransformer: (program: ts.Program) => UcTransformer;

  beforeEach(() => {
    tasks = {
      compileUcDeserializer: jest.fn(),
      compileUcSerializer: jest.fn(),
    };
    createUcTransformer = program => new UcTransformer(program, tasks);
  });

  it('discovers serializer', () => {
    transform('create-serializer.ts', createUcTransformer);

    expect(tasks.compileUcSerializer).toHaveBeenCalledTimes(1);
  });
  it('discovers serializer via imports', () => {
    transform('create-serializer-via-import.ts', createUcTransformer);

    expect(tasks.compileUcSerializer).toHaveBeenCalledTimes(1);
  });
  it('discovers deserializer via alias', () => {
    transform('create-deserializer-via-alias.ts', createUcTransformer);

    expect(tasks.compileUcDeserializer).toHaveBeenCalledTimes(1);
  });
});
