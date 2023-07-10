import path from 'node:path';
import ts from 'typescript';

export interface TsVfs {
  readonly [path: string]: string;
}

export function createTsVfs(dir: string, vfsFiles: TsVfs): TsVfs {
  const rootDir = path.resolve(dir);

  return Object.fromEntries(
    Object.entries(vfsFiles).map(([filePath, content]) => [
      ts.sys.resolvePath(path.resolve(rootDir, filePath)),
      content,
    ]),
  );
}
