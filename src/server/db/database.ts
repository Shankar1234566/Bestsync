/**
 * SQLite persistence layer built on Node's built-in `node:sqlite`.
 * Zero native dependencies; WAL journaling and foreign keys enabled.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations';

export type SqlValue = null | number | bigint | string | Uint8Array;

/** Normalize JS values so SQLite never rejects a parameter. */
function normalize(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  return String(value);
}

function normalizeAll(params: unknown[]): SqlValue[] {
  return params.map(normalize);
}

export class Database {
  private readonly handle: DatabaseSync;

  constructor(filePath: string) {
    if (filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.handle = new DatabaseSync(filePath);
    this.handle.exec('PRAGMA journal_mode = WAL;');
    this.handle.exec('PRAGMA foreign_keys = ON;');
    this.handle.exec('PRAGMA busy_timeout = 5000;');
    runMigrations(this);
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.handle.prepare(sql).all(...normalizeAll(params)) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.handle.prepare(sql).get(...normalizeAll(params)) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const result = this.handle.prepare(sql).run(...normalizeAll(params));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  /** Run raw SQL (may contain several statements). Used by migrations. */
  exec(sql: string): void {
    this.handle.exec(sql);
  }

  /** Synchronous transaction with rollback on throw. */
  transaction<T>(fn: () => T): T {
    this.handle.exec('BEGIN');
    try {
      const result = fn();
      this.handle.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.handle.exec('ROLLBACK');
      } catch {
        // Rollback failure must not mask the original error.
      }
      throw error;
    }
  }

  close(): void {
    this.handle.close();
  }
}
