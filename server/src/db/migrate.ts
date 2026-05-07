import Database from 'better-sqlite3';
import { initDb, getDb, closeDb } from './sqlite.js';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const MIGRATIONS_DIR = join(import.meta.dirname!, 'migrations');

export { initDb, getDb, closeDb };
