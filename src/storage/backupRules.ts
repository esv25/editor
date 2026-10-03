/**
 * Backups before overwriting (NSM 2.9, recover data) as plain rules – no I/O,
 * tested in tests/backup.test.ts. The first time a file is overwritten in a
 * session, its old content is copied to backups/<day>/<time> <name>; days
 * older than `BACKUP_DAYS` are removed.
 */

export const BACKUP_DAYS = 30;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Folder name for a day: 2026-10-03 (sorts by date). */
export function backupDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** File name for a backup: "142530 notat.md" (the time keeps several the same day apart). */
export function backupFileName(date: Date, fileName: string): string {
  const safe = fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'fil';
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())} ${safe}`;
}

/** The day folders (among `names`) that are older than `keepDays` before `today`. */
export function expiredBackupDays(names: string[], today: Date, keepDays = BACKUP_DAYS): string[] {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays);
  const oldest = backupDay(cutoff);
  return names.filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name < oldest);
}
