import winston, { createLogger, transports, format } from "winston";

type LogLevel = "warn" | "debug" | "info" | "error";
type WinstonLogLevel = "warning" | "debug" | "info" | "error";

const logToWinstonLevel = (level: LogLevel): WinstonLogLevel =>
  level === "warn" ? "warning" : level;
const winstonToLevel = (level: WinstonLogLevel): LogLevel =>
  level === "warning" ? "warn" : level;

class Logger {
  private logger: winston.Logger;
  private name: string;
  private transportsToUse: winston.transport[];

  constructor(name: string) {
    this.transportsToUse = [new transports.Console()];
    this.logger = createLogger({
      transports: this.transportsToUse,
      format: format.combine(
        format((info) => {
          info.level = info.level.toUpperCase();
          return info;
        })(),
        format.colorize(),
        format.label({ label: name }),
        format.timestamp({ format: "YYYY-MM-DD hh:mm:ss" }),
        format.printf(({ timestamp, label, level, message }) => {
          return `[${timestamp}][${label}] ${level}: ${message}`;
        }),
      ),
    });
    this.name = name;
  }

  getLevel(): LogLevel {
    return winstonToLevel(this.transportsToUse[0].level as WinstonLogLevel);
  }

  setLevel(level: LogLevel): void {
    this.logger.transports.forEach(
      (transport) => (transport.level = logToWinstonLevel(level as LogLevel)),
    );
  }

  warn(message: string): void {
    // winston.config.syslog.levels doesn't have warn, but is required for syslog.
    this.logger.warning(message);
  }

  warning(message: string): void {
    this.logger.warning(message);
  }

  info(message: string): void {
    this.logger.info(message);
  }

  debug(message: string): void {
    this.logger.debug(message);
  }

  error(message: string): void {
    this.logger.error(message);
  }
}

class LoggerFactory {
  private loggers: Logger[] = [];
  private default?: Logger;

  setLevel(level: LogLevel): void {
    this.loggers.forEach((logger) => logger.setLevel(level));
  }

  public getLogger(name: string): Logger {
    const logger = new Logger(name);
    this.loggers.push(logger);
    return logger;
  }

  public getDefault() {
    if (this.default === undefined) {
      this.default = this.getLogger("RFXCOM2MQTT");
    }
    return this.default;
  }
}

const loggerFactory = new LoggerFactory();
const logger = loggerFactory.getDefault();
export { loggerFactory, logger };
