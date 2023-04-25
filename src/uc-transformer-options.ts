/**
 * Options for ChURI transformer.
 */
export interface UcTransformerOptions {
  /**
   * Distribution files.
   */
  readonly dist?: UcTransformerDistributive | undefined;

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

/**
 * Distribution files emitted by ChURI transformer.
 */
export interface UcTransformerDistributive {
  /**
   * Path to distribution file containing deserializers relative to current working directory.
   *
   * If unspecified, will be guessed based on package main file.
   */
  readonly deserializer?: string | undefined;

  /**
   * Path to distribution file containing serializers relative to current working directory.
   *
   * If unspecified, will be guessed based on package main file.
   */
  readonly serializer?: string | undefined;
}
