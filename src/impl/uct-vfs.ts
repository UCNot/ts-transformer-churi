import path from 'node:path';
import ts from 'typescript';

export interface UctVfs {
  readonly [path: string]: string;
}

export function createUctVfs(host: ts.CompilerHost, vfsFiles: UctVfs, dir?: string): UctVfs {
  const cwd = host.getCurrentDirectory();
  const rootDir = dir ? path.resolve(cwd, dir) : cwd;

  return Object.fromEntries(
    Object.entries(vfsFiles).map(([filePath, content]) => [
      ts.sys.resolvePath(path.resolve(rootDir, filePath)),
      content,
    ]),
  );
}
