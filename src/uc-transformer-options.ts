/**
 * Options for ChURI transformer.
 */
export interface UcTransformerOptions {
  /**
   * Distribution files.
   */
  readonly dist?: UcTransformerDistributive | undefined;
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
