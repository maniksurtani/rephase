import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

it('restores only incident account buckets and preserves provider protection and newer usage', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../migrations/0002_flight_cache.sql', import.meta.url), 'utf8'));
    const cutoff = Date.parse('2026-10-15T06:41:31Z') / 1000 + 40 * 86400;
    const rows: [string, string, number, number][] = [
      ['user:affected', 'day:2026-10-15', 10, cutoff - 60],
      ['user:affected', 'month:2026-10', 10, cutoff - 60],
      ['global', 'month:2026-10', 10, cutoff - 60],
      ['user:newer', 'day:2026-10-15', 4, cutoff + 60],
      ['user:newer', 'month:2026-10', 4, cutoff + 60],
      ['user:affected', 'day:2026-10-14', 7, cutoff - 60],
      ['user:affected', 'month:2026-09', 30, cutoff - 60],
    ];
    for (const row of rows) db.prepare('INSERT INTO flight_usage VALUES (?, ?, ?, ?)').run(...row);
    db.prepare('INSERT INTO flight_cache VALUES (?, ?, ?, ?, ?)').run('existing', 'unchanged', 1, 2, 3);
    db.exec(readFileSync(new URL('../migrations/0004_restore_incident_flight_allowance.sql', import.meta.url), 'utf8'));
    for (const [principal, bucket, requests, retainUntil] of rows) {
      const recovered = principal === 'user:affected' && ['day:2026-10-15', 'month:2026-10'].includes(bucket);
      expect(db.prepare('SELECT requests, retain_until FROM flight_usage WHERE principal = ? AND bucket = ?').get(principal, bucket))
        .toEqual({ requests: recovered ? 0 : requests, retain_until: retainUntil });
    }
    expect(db.prepare('SELECT data FROM flight_cache').get()).toEqual({ data: 'unchanged' });
  } finally { db.close(); }
});
