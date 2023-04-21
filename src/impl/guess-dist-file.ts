import { PackageInfo } from '@run-z/npk';
import path from 'node:path';

export function guessDistFile(): string {
  const { type, mainEntryPoint: mainEntryPoint } = loadPackageInfo();

  const indexFile = mainEntryPoint?.findJs(type);
  let indexName: string;

  if (indexFile) {
    indexName = indexFile.slice(0, -path.extname(indexFile).length);
  } else {
    indexName = './index';
  }

  return indexName + (type === 'module' ? '.uc-lib.js' : '.uc-lib.mjs');
}

let packageInfo: PackageInfo | undefined;

export function loadPackageInfo(): PackageInfo {
  return (packageInfo ??= PackageInfo.loadSync());
}
