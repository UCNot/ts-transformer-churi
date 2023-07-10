import path from 'node:path';
import ts from 'typescript';

export class TsRoot {

  #rootDir?: string;

  get rootDir(): string | undefined {
    return this.#rootDir;
  }

  updateRootDir({ fileName }: ts.SourceFile): void {
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

}
