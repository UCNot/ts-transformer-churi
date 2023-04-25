import ts from 'typescript';
import { UctVfs } from './uct-vfs.js';

export function wrapUctCompilerHost(host: ts.CompilerHost, vfs: UctVfs = {}): ts.CompilerHost {
  const { useCaseSensitiveFileNames } = host;

  return {
    // ModuleResolutionHost
    fileExists(fileName: string): boolean {
      return vfs[fileName] != null || host.fileExists(fileName);
    },
    readFile(fileName: string): string | undefined {
      return vfs[fileName] ?? host.readFile(fileName);
    },
    trace: host.trace?.bind(host),
    // directoryExists: host.directoryExists?.bind(host),
    realpath: host.realpath ? path => (vfs[path] ? path : host.realpath!(path)) : undefined,
    getCurrentDirectory: host.getCurrentDirectory?.bind(host),
    getDirectories: host.getDirectories?.bind(host),
    useCaseSensitiveFileNames:
      typeof useCaseSensitiveFileNames === 'function'
        ? useCaseSensitiveFileNames.bind(host)
        : useCaseSensitiveFileNames,
    // CompilerHost
    getSourceFile(
      fileName: string,
      languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
      onError?: (message: string) => void,
      shouldCreateNewSourceFile?: boolean,
    ): ts.SourceFile | undefined {
      const content = vfs[fileName];

      if (content != null) {
        return ts.createSourceFile(
          fileName,
          content,
          languageVersionOrOptions,
          true,
          ts.ScriptKind.TS,
        );
      }

      return host.getSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    // getSourceFileByPath: (...) => {}, // not providing this will force it to use the file name as the file path
    getCancellationToken: host.getCancellationToken?.bind(host),
    getDefaultLibFileName: host.getDefaultLibFileName.bind(host),
    getDefaultLibLocation: host.getDefaultLibLocation?.bind(host),
    writeFile: host.writeFile.bind(host),
    getCanonicalFileName: host.getCanonicalFileName.bind(host),
    getNewLine: host.getNewLine.bind(host),
    readDirectory: host.readDirectory?.bind(host),
    getModuleResolutionCache: host.getModuleResolutionCache?.bind(host),
    resolveModuleNameLiterals: host.resolveModuleNameLiterals?.bind(host),
    resolveTypeReferenceDirectiveReferences:
      host.resolveTypeReferenceDirectiveReferences?.bind(host),
    getEnvironmentVariable: host.getEnvironmentVariable?.bind(host),
    hasInvalidatedResolutions: host.hasInvalidatedResolutions?.bind(host),
    createHash: host.createHash?.bind(host),
    getParsedCommandLine: host.getParsedCommandLine?.bind(host),
  };
}
