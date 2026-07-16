import "server-only";

// Single-line JSON logs on stdout/stderr — Vercel ingests these as structured
// log entries, so no logging dependency is needed. Keep field names stable:
// dashboards and log queries key on them.

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function emit(level: Level, msg: string, fields: Fields = {}): void {
  const line = JSON.stringify({
    level,
    msg,
    ts: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};

/** Short, log-safe rendering of an unknown thrown value (never a full stack in fields). */
export function errorField(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
