import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import { migrate } from './migrations'

let db: Database.Database | null = null

// The DB key is random and stored encrypted by the OS keychain (DPAPI / Keychain).
function loadOrCreateKey(): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage unavailable; refusing to open patient database')
  }
  const keyFile = join(app.getPath('userData'), 'db.key')
  if (existsSync(keyFile)) {
    return safeStorage.decryptString(readFileSync(keyFile))
  }
  const key = randomBytes(32).toString('hex')
  writeFileSync(keyFile, safeStorage.encryptString(key))
  return key
}

export function getDb(): Database.Database {
  if (db) return db
  const conn = new Database(join(app.getPath('userData'), 'flowpt.db'))
  conn.pragma("cipher='sqlcipher'")
  conn.pragma(`key="x'${loadOrCreateKey()}'"`)
  conn.pragma('journal_mode = WAL')
  conn.pragma('foreign_keys = ON')
  migrate(conn)
  db = conn
  return conn
}

export function closeDb(): void {
  db?.close()
  db = null
}
