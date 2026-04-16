// BrowserAutoDrive — Structured Logging
// Production-grade logging with levels, timestamps, and structured fields

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  fields?: Record<string, unknown>;
  duration?: number;
  error?: string;
}

export class Logger {
  private minLevel: LogLevel;
  private entries: LogEntry[] = [];
  private maxEntries: number;

  constructor(minLevel: LogLevel = LogLevel.INFO, maxEntries: number = 1000) {
    this.minLevel = minLevel;
    this.maxEntries = maxEntries;
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, fields);
  }

  error(message: string, error?: Error, fields?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, { ...fields, error: error?.message });
  }

  private log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (level < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
      ...(fields && { fields }),
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Console output
    const prefix = `[${entry.timestamp}] [${entry.level}]`;
    const fieldStr = fields ? ` ${JSON.stringify(fields)}` : "";
    switch (level) {
      case LogLevel.ERROR:
        console.error(`${prefix} ${message}${fieldStr}`);
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} ${message}${fieldStr}`);
        break;
      case LogLevel.INFO:
        console.info(`${prefix} ${message}${fieldStr}`);
        break;
      default:
        console.log(`${prefix} ${message}${fieldStr}`);
    }
  }

  getEntries(level?: LogLevel): LogEntry[] {
    if (level !== undefined) {
      return this.entries.filter((e) => LogLevel[e.level as keyof typeof LogLevel] >= level);
    }
    return [...this.entries];
  }

  getRecent(count: number = 50): LogEntry[] {
    return this.entries.slice(-count);
  }

  clear(): void {
    this.entries = [];
  }

  /** Time a function and log the duration */
  async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.debug(`${label} completed`, { duration: Date.now() - start });
      return result;
    } catch (err) {
      this.error(`${label} failed`, err instanceof Error ? err : new Error(String(err)), { duration: Date.now() - start });
      throw err;
    }
  }
}

// Singleton logger for application-wide use
let globalLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(
      (process.env.LOG_LEVEL?.toUpperCase() === "DEBUG" ? LogLevel.DEBUG :
       process.env.LOG_LEVEL?.toUpperCase() === "WARN" ? LogLevel.WARN :
       process.env.LOG_LEVEL?.toUpperCase() === "ERROR" ? LogLevel.ERROR :
       process.env.LOG_LEVEL?.toUpperCase() === "SILENT" ? LogLevel.SILENT :
       LogLevel.INFO)
    );
  }
  return globalLogger;
}

export function resetLogger(): void {
  globalLogger = null;
}
