export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    for (const key of ["message", "msg", "error", "reason"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return String(error);
}
