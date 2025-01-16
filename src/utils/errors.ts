/**
 * Error codes for code generation and schema operations
 */
export enum GeneratorErrorCode {
  INITIALIZATION_ERROR = 'INITIALIZATION_ERROR',
  SCHEMA_ERROR = 'SCHEMA_ERROR',
  GENERATION_ERROR = 'GENERATION_ERROR',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
  TYPE_GENERATION_ERROR = 'TYPE_GENERATION_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  MARSHAL_ERROR = 'MARSHAL_ERROR',
  UNMARSHAL_ERROR = 'UNMARSHAL_ERROR',
  EVENTBRIDGE_PUBLISH_ERROR = 'EVENTBRIDGE_PUBLISH_ERROR',
  EVENTBRIDGE_CONSUME_ERROR = 'EVENTBRIDGE_CONSUME_ERROR',
}

/**
 * Custom error class for code generation and schema operations
 */
export class GeneratorError extends Error {
  constructor(
    public code: GeneratorErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'GeneratorError';
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GeneratorError);
    }

    // If there's a cause, append its stack to ours
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }

  /**
   * Get a detailed error message including the cause if available
   */
  getDetailedMessage(): string {
    let message = `${this.code}: ${this.message}`;
    if (this.cause instanceof Error) {
      message += `\nCaused by: ${this.cause.message}`;
    }
    return message;
  }
}
