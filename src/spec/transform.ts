import path from 'node:path';
import ts from 'typescript';
import { UctVfs, createUctVfs, wrapUctCompilerHost } from '../impl/uct-compiler-host.js';
import { UcTransformer } from '../impl/uc-transformer.js';

export function transform(
  vfsFiles: UctVfs,
  createUcTransformer: (program: ts.Program) => UcTransformer = program => new UcTransformer(program),
): string {
  const testDir = path.resolve('src', 'spec', 'tests');
  const testFile = path.resolve(testDir, Object.keys(vfsFiles)[0]);
  const program = createProgram(vfsFiles, testDir);

  const ucTransformer = createUcTransformer(program);
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

function createProgram(vfsFiles: UctVfs, dir?: string): ts.Program {
  const { options } = loadCompilerConfig();
  const host = ts.createCompilerHost(options, true);
  const vfs = createUctVfs(host, vfsFiles, dir);

  return ts.createProgram({
    rootNames: [Object.keys(vfs)[0]],
    options,
    host: wrapUctCompilerHost(host, vfs),
  });
}

function loadCompilerConfig(): {
  options: ts.CompilerOptions;
  fileNames: string[];
} {
  const tsconfig = 'tsconfig.spec.json';
  const cwd = ts.sys.getCurrentDirectory();
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, tsconfig)!;

  const {
    config,
    error,
  }: {
    readonly config?: unknown;
    readonly error?: ts.Diagnostic;
  } = ts.readConfigFile(configPath, ts.sys.readFile);

  if (error) {
    console.error(ts.formatDiagnostic(error, FORMAT_HOST));

    throw new Error(`Failed to load ${tsconfig}`);
  }

  const { options, fileNames, errors } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    cwd,
    undefined,
    tsconfig,
  );

  if (errors && errors.length) {
    for (const error of errors) {
      console.error(ts.formatDiagnostic(error, FORMAT_HOST));
    }

    throw new Error(`Failed to parse ${tsconfig}`);
  }

  return { options, fileNames };
}
