import { describe, expect, it } from 'vitest';
import { backupDay, backupFileName, expiredBackupDays } from '../src/storage/backupRules';

describe('backups', () => {
  const at = new Date(2026, 9, 3, 14, 5, 9); // 3 Oct 2026 14:05:09

  it('names day folders so they sort by date', () => {
    expect(backupDay(at)).toBe('2026-10-03');
    expect(backupDay(new Date(2026, 0, 9))).toBe('2026-01-09');
  });

  it('names backups by time and keeps the file name', () => {
    expect(backupFileName(at, 'notat.md')).toBe('140509 notat.md');
    expect(backupFileName(at, 'tegning.diagram.svg')).toBe('140509 tegning.diagram.svg');
  });

  it('never lets a name leave the backup folder', () => {
    expect(backupFileName(at, '..\\..\\x.md')).toBe('140509 .._.._x.md');
    expect(backupFileName(at, 'a/b:c.md')).toBe('140509 a_b_c.md');
    expect(backupFileName(at, '')).toBe('140509 fil');
  });

  it('removes only day folders older than the limit', () => {
    const names = ['2026-09-02', '2026-09-03', '2026-09-04', '2026-10-03', 'annet', '2026-9-1'];
    expect(expiredBackupDays(names, at, 30)).toEqual(['2026-09-02']);
  });
});
