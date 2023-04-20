import path from 'node:path';
import { PackageJson } from './package.json.js';

export function guessDistFile(): string {
  const {
    raw: { type },
    mainEntry,
  } = PackageJson.load();

  const indexFile =
    mainEntry
    && (mainEntry.findConditional(type === 'module' ? 'import' : 'require')
      || mainEntry.findConditional());
  let indexName: string;

  if (indexFile) {
    indexName = indexFile.slice(0, -path.extname(indexFile).length);
  } else {
    indexName = './index';
  }

  return indexName + (type === 'module' ? '.uc-lib.js' : '.uc-lib.mjs');
}
