/**
 * Options for ChURI transformer.
 */
export interface UcTransformerOptions {
  /**
   * Path to distribution file relative to current working directory.
   *
   * If not specified, then will be guessed based on package main file.
   */
  readonly distFile?: string | undefined;
}
