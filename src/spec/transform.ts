import path from 'node:path';
import ts from 'typescript';
import { UcTransformer } from '../impl/uc-transformer.js';

export function transform(
  fileName: string,
  createUcTransformer: (program: ts.Program) => UcTransformer = program => new UcTransformer(program),
): string {
  const filePath = path.resolve('src', 'spec', 'tests', fileName);
  const program = createProgram(filePath);
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) {
    throw new ReferenceError(`No such file: ${filePath}`);
  }

  const ucTransformer = createUcTransformer(program);
  let output!: string;

  const { diagnostics } = program.emit(
    undefined /* all files */,
    (fileName, text) => {
      if (fileName === filePath) {
        output = text;
      }
    },
    undefined,
    false,
    {
      after: [ucTransformer.createTransformerFactory()],
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

function createProgram(...additionalFiles: string[]): ts.Program {
  const { options, fileNames } = loadCompilerConfig(...additionalFiles);

  return ts.createProgram({
    rootNames: fileNames,
    options,
    host: ts.createCompilerHost(options, true),
  });
}

function loadCompilerConfig(...additionalFiles: string[]): {
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

  return { options, fileNames: [...fileNames, ...additionalFiles] };
}
