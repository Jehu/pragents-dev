import Database from 'better-sqlite3';
import { readFileSync, readdirSync, copyFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logging/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_BACKUP_GENERATIONS = 5;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

/**
 * Copy the current DB file to backupDir/pragents-{timestamp}.db.
 * Prunes old backups so only the newest maxGenerations are kept.
 * Non-fatal: logs a warning on failure and continues.
 */
export function createBackup(dbPath: string, backupDir: string, maxGenerations = MAX_BACKUP_GENERATIONS): void {
  try {
    mkdirSync(backupDir, { recursive: true });
    const dest = join(backupDir, `pragents-${Date.now()}.db`);
    copyFileSync(dbPath, dest);
    logger.info({ dest }, 'DB backup created');

    // Prune old generations
    const backups = readdirSync(backupDir)
      .filter((f) => f.startsWith('pragents-') && f.endsWith('.db'))
      .sort(); // lexicographic == chronological since we use Date.now()

    if (backups.length > maxGenerations) {
      const toDelete = backups.slice(0, backups.length - maxGenerations);
      for (const old of toDelete) {
        try {
          unlinkSync(join(backupDir, old));
          logger.debug({ file: old }, 'Old DB backup pruned');
        } catch {
          // best-effort — pruning failure is not critical
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to create DB backup — continuing');
  }
}

/**
 * Find the newest backup in backupDir and restore it to dbPath.
 * Returns true on success, false if no backups exist.
 */
export function restoreLatestBackup(dbPath: string, backupDir: string): boolean {
  if (!existsSync(backupDir)) return false;

  const backups = readdirSync(backupDir)
    .filter((f) => f.startsWith('pragents-') && f.endsWith('.db'))
    .sort();

  if (backups.length === 0) return false;

  const latest = join(backupDir, backups[backups.length - 1]);
  copyFileSync(latest, dbPath);
  logger.info({ src: latest, dest: dbPath }, 'DB restored from backup');
  return true;
}

function openAndConfigure(dbPath: string): Database.Database {
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  return instance;
}

export function initDb(dbPath: string): Database.Database {
  const backupDir = join(dirname(dbPath), 'backups');

  // Create a rolling snapshot before we do anything else (only if DB already exists)
  if (existsSync(dbPath)) {
    createBackup(dbPath, backupDir);
  }

  db = openAndConfigure(dbPath);

  // Integrity check
  const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
  if (integrity.length > 0 && integrity[0].integrity_check !== 'ok') {
    logger.error(
      { result: integrity[0].integrity_check },
      'Database integrity check failed — attempting restore from backup',
    );

    // Close the corrupt DB before overwriting the file
    db.close();
    db = null;

    const restored = restoreLatestBackup(dbPath, backupDir);
    if (!restored) {
      throw new Error(
        `Database integrity check failed and no backup is available. DB path: ${dbPath}. ` +
          `You can try removing the file and restarting (all data will be lost), ` +
          `or restore from an external backup.`,
      );
    }

    // Re-open the restored DB and verify it is healthy
    db = openAndConfigure(dbPath);
    const recheck = db.pragma('integrity_check') as { integrity_check: string }[];
    if (recheck.length > 0 && recheck[0].integrity_check !== 'ok') {
      db.close();
      db = null;
      throw new Error(
        `Database integrity check failed on restored backup as well. DB path: ${dbPath}. ` +
          `Please restore from an external backup or remove the file and restart.`,
      );
    }

    logger.info('Database successfully restored from backup');
  }

  runMigrations(db);
  return db;
}

function runMigrations(database: Database.Database): void {
  database.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");

  const applied = new Set(
    database.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name),
  );

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const run = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    });

    run();
    logger.info({ file }, 'Migration applied');
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
