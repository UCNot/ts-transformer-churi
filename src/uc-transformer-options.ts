/**
 * Options for ChURI transformer.
 */
export interface UcTransformerOptions {
  /**
   * Path to distribution file relative to current working directory.
   *
   * If unspecified, will be guessed based on package main file.
   */
  readonly dist?: string | undefined;

  /**
   * Path to temporary directory.
   *
   * Generated schema compiler files will be placed there.
   *
   * Will be removed after schema compilation.
   *
   * By default, created inside [outDir] if one exists. Otherwise, a temporary directory will be created inside
   * `node_modules`.
   *
   * [outDir]: https://www.typescriptlang.org/tsconfig#outDir
   */
  readonly tempDir?: string | undefined;
}
