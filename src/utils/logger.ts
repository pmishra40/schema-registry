/**
 * Logger interface for schema registry operations
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

/**
 * Log levels for controlling output verbosity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

/**
 * Enhanced console logger implementation with log levels and structured logging
 */
export class ConsoleLogger implements ILogger {
  constructor(private level: LogLevel = LogLevel.INFO) {}

  private shouldLog(messageLevel: LogLevel): boolean {
    return messageLevel >= this.level;
  }

  private formatMessage(message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    let formatted = `${timestamp} ${message}`;
    if (context && Object.keys(context).length > 0) {
      formatted += ` ${JSON.stringify(context)}`;
    }
    return formatted;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(`[DEBUG] ${this.formatMessage(message, context)}`);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(`[INFO] ${this.formatMessage(message, context)}`);
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`[WARN] ${this.formatMessage(message, context)}`);
    }
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorContext = {
        ...context,
        errorName: error?.name,
        errorMessage: error?.message,
        errorStack: error?.stack
      };
      console.error(`[ERROR] ${this.formatMessage(message, errorContext)}`);
    }
  }
}
