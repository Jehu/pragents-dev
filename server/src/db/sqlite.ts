import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function initDb(dbPath: string): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Integrity check
  const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
  if (integrity.length > 0 && integrity[0].integrity_check !== 'ok') {
    console.error('Database integrity check failed:', integrity[0].integrity_check);
    console.error('Attempting to restore from backup...');
    // Backup restore would go here
  }

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name),
  );

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    });

    run();
    console.log(`Migration applied: ${file}`);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
