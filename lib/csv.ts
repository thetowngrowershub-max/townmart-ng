/**
 * One CSV cell: quoted when needed, and text starting with = + - @ prefixed
 * with ' so spreadsheets don't run it as a formula (numbers are left alone).
 */
export function csvCell(v: string): string {
  const safe = /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvRows = (rows: string[][]): string => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
