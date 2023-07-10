import path from 'node:path';
import ts from 'typescript';
import { reportTsErrors } from '../impl/ts/report-ts-errors.js';
import { wrapTsCompilerHost } from '../impl/ts/ts-compiler-host.js';
import { TsVfs, createTsVfs } from '../impl/ts/ts-vfs.js';
import { UcTransformer } from '../impl/uc-transformer.js';

export function transform(
  vfsFiles: TsVfs,
  createUcTransformer: (program: ts.Program, vfs: TsVfs) => UcTransformer,
): string {
  const testDir = path.resolve('src', 'spec', 'tests');
  const testFile = path.resolve(testDir, Object.keys(vfsFiles)[0]);
  const { program, vfs } = createProgram(vfsFiles, testDir);

  if (reportTsErrors(FORMAT_HOST, ts.getPreEmitDiagnostics(program))) {
    throw new Error('Failed to compile');
  }

  const ucTransformer = createUcTransformer(program, vfs);
  let output!: string;

  const { diagnostics } = program.emit(
    undefined /* all files */,
    (fileName, text, _writeByteOrderMark, _onError, sourceFiles) => {
      if (fileName.endsWith('.js') && sourceFiles?.find(({ fileName }) => fileName === testFile)) {
        output = text;
      }
    },
    undefined,
    false,
    {
      before: [ucTransformer.createTransformerFactory()],
    },
  );

  if (diagnostics.length) {
    for (const error of diagnostics) {
      console.error(ts.formatDiagnostic(error, FORMAT_HOST));
    }

    throw new Error('Failed to compile');
  }

  return output;
}

const FORMAT_HOST: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? f => f : f => f.toLowerCase(),
};

function createProgram(vfsFiles: TsVfs, dir?: string): { program: ts.Program; vfs: TsVfs } {
  const { options } = loadCompilerConfig();
  const host = ts.createCompilerHost(options, true);
  const cwd = host.getCurrentDirectory();
  const vfs = createTsVfs(dir ? path.resolve(cwd, dir) : cwd, vfsFiles);

  return {
    program: ts.createProgram({
      rootNames: [Object.keys(vfs)[0]],
      options,
      host: wrapTsCompilerHost(host, vfs),
    }),
    vfs,
  };
}

function loadCompilerConfig(): {
  options: ts.CompilerOptions;
  fileNames: string[];
} {
  const tsconfig = 'tsconfig.json';
  const cwd = ts.sys.getCurrentDirectory();
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, tsconfig)!;

  const {
    config,
    error,
  }: {
    readonly config?: unknown;
    readonly error?: ts.Diagnostic;
  } = ts.readConfigFile(configPath, ts.sys.readFile);

  if (error && reportTsErrors(FORMAT_HOST, [error])) {
    throw new Error(`Failed to load ${tsconfig}`);
  }

  const { options, fileNames, errors } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    cwd,
    undefined,
    tsconfig,
  );

  if (reportTsErrors(FORMAT_HOST, errors)) {
    throw new Error(`Failed to parse ${tsconfig}`);
  }

  return { options, fileNames };
}
