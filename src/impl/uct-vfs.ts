import path from 'node:path';
import ts from 'typescript';

export interface UctVfs {
  readonly [path: string]: string;
}

export function createUctVfs(dir: string, vfsFiles: UctVfs): UctVfs {
  const rootDir = path.resolve(dir);

  return Object.fromEntries(
    Object.entries(vfsFiles).map(([filePath, content]) => [
      ts.sys.resolvePath(path.resolve(rootDir, filePath)),
      content,
    ]),
  );
}
