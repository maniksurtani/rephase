import type { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';

/** Execute actual SQLite queries and preserve D1's atomic batch semantics. */
export function d1For(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...args: (string | number | null)[]) {
        values = args;
        return statement;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} };
      },
      _run() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
      async run() {
        return statement._run();
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN');
      try {
        // No await between statements: another request must not observe a
        // partially applied batch or open a transaction inside this one.
        const results = statements.map((statement) => statement._run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}
