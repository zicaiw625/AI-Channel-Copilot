const appendContext = (
  context?: Record<string, unknown>,
  extra?: Record<string, unknown>,
) => ({
  timestamp: new Date().toISOString(),
  ...(context || {}),
  ...(extra || {}),
});

const base = (level: "info" | "warn" | "error") =>
  (message: string, context?: Record<string, unknown>, extra?: Record<string, unknown>) => {
    // eslint-disable-next-line no-console
    console[level](message, appendContext(context, extra));
  };

export const logger = {
  info: base("info"),
  warn: base("warn"),
  error: base("error"),
};

export type LogContext = {
  shopDomain?: string;
  jobType?: string;
  jobId?: number | string;
  intent?: string;
};
