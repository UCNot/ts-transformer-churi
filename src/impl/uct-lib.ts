import { isPresent } from '@proc7ts/primitives';
import { UccCode, UccLib, UccSource } from 'churi/compiler';
import path from 'node:path';
import ts from 'typescript';
import { UctSetup } from './uct-setup.js';
import { UctCompileFn, UctTasks } from './uct-tasks.js';

export class UctLib extends UccLib implements UctTasks {

  readonly #tasks: (() => void)[] = [];
  #rootDir?: string;

  #ucdModels?: UccCode;
  #ucsModels?: UccCode;

  constructor(_setup: UctSetup) {
    super();
  }

  compileUcDeserializer(task: UctCompileFn): void {
    this.#updateRootDir(task.from);
    this.#tasks.push(() => this.#compileUcDeserializer(task));
  }

  #compileUcDeserializer(task: UctCompileFn): void {
    (this.#ucdModels ??= new UccCode()).write(this.#addModel(task));
  }

  compileUcSerializer(task: UctCompileFn): void {
    this.#updateRootDir(task.from);
    this.#tasks.push(() => this.#compileUcSerializer(task));
  }

  #compileUcSerializer(task: UctCompileFn): void {
    (this.#ucsModels ??= new UccCode()).write(this.#addModel(task));
  }

  #updateRootDir({ fileName }: ts.SourceFile): void {
    const dir = path.dirname(fileName);

    if (!this.#rootDir) {
      this.#rootDir = dir;

      return;
    }

    let rootFragments = this.#rootDir.split(path.sep);
    let dirFragments = dir.split(path.sep);

    if (dirFragments.length < rootFragments.length) {
      [rootFragments, dirFragments] = [dirFragments, rootFragments];
    }

    for (let i = 0; i < rootFragments.length; ++i) {
      if (rootFragments[i] !== dirFragments[i]) {
        this.#rootDir = rootFragments.slice(0, i).join(path.sep);
      }
    }
  }

  #addModel({ fnId, modelId, from: { fileName } }: UctCompileFn): UccSource {
    const moduleName = fileName.endsWith('ts')
      ? fileName.slice(0, -2) + 'js'
      : fileName.endsWith('tsx')
      ? fileName.slice(0, -3) + '.js'
      : fileName;
    const modulePath = path.relative(this.#rootDir!, moduleName);
    let moduleSpec = modulePath.replaceAll(path.sep, '/');

    if (!moduleSpec.startsWith('./') && !moduleSpec.startsWith('../')) {
      moduleSpec = './' + moduleSpec;
    }

    const model = this.import(moduleSpec, modelId);

    return `${fnId}: ${model},`;
  }

  async emitCompilerSource(): Promise<UctLib.CompilerSource | undefined> {
    const code = this.#toCompilerCode();

    if (!code) {
      return;
    }

    return {
      fileName: path.join(this.#rootDir!, 'uc-lib.compiler.ts'),
      sourceText: await new UccCode()
        .write(this.imports.asStatic(), '', this.declarations, '', code)
        .toText(),
    };
  }

  #toCompilerCode(): UccSource | undefined {
    this.#tasks.forEach(task => task());

    const fns = [this.#compileDeserializers(), this.#compileSerializers()].filter(isPresent);

    if (!fns.length) {
      return;
    }
    if (fns.length === 1) {
      return `await ${fns[0]}();`;
    }

    return code => {
      code
        .write(`await Promise.all[`)
        .indent(...fns.map(fn => `${fn}(),`))
        .write(']);');
    };
  }

  #compileDeserializers(): string | undefined {
    const ucdModels = this.#ucdModels;

    if (!ucdModels) {
      return;
    }

    const writeFile = this.import('node:fs/promises', 'writeFile');
    const UcdLib = this.import('churi/compiler', 'UcdLib');

    return this.declarations.declare('compileDeserializers', ({ init }) => init(code => {
        code
          .write(`async () => await ${writeFile}(`)
          .indent(code => {
            code
              .write(`await new ${UcdLib}({`)
              .indent(ucdModels)
              .write('}).compileModule().toText(),', '');
          })
          .write(')');
      }));
  }

  #compileSerializers(): string | undefined {
    const ucsModels = this.#ucsModels;

    if (!ucsModels) {
      return;
    }

    const writeFile = this.import('node:fs/promises', 'writeFile');
    const UcsLib = this.import('churi/compiler', 'UcsLib');

    return this.declarations.declare('compileSerializers', ({ init }) => init(code => {
        code
          .write(`async () => await ${writeFile}(`)
          .indent(code => {
            code
              .write(`await new ${UcsLib}({`)
              .indent(ucsModels)
              .write('}).compileModule().toText(),', '');
          })
          .write(')');
      }));
  }

}

export namespace UctLib {
  export interface CompilerSource {
    readonly fileName: string;
    readonly sourceText: string;
  }
}
