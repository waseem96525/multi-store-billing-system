// Migrates data from the local SQLite database (shop.db) to a remote Turso
// database. Preserves row IDs so foreign keys stay valid.
//
// Usage:
//   TURSO_URL=libsql://xxx.turso.io TURSO_AUTH_TOKEN=xxx node scripts/migrate-to-turso.js
//   Optional: LOCAL_DB=/path/to/shop.db  --force (skip confirmation)
const path = require('path');
const readline = require('readline');
const DatabaseSync = require('libsql');

const localPath =
  process.env.LOCAL_DB || path.join(__dirname, '..', 'data', 'shop.db');
const remoteUrl = process.env.TURSO_URL;
const remoteToken = process.env.TURSO_AUTH_TOKEN;

if (!remoteUrl || !remoteToken) {
  console.error('Missing TURSO_URL or TURSO_AUTH_TOKEN environment variables.');
  process.exit(1);
}

// Foreign-key-safe copy order.
const TABLE_ORDER = [
  'users',
  'categories',
  'suppliers',
  'customers',
  'products',
  'invoices',
  'invoice_items',
  'purchases',
  'purchase_items',
  'stock_adjustments',
  'held_bills',
];

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

async function main() {
  let localDb;
  try {
    localDb = new DatabaseSync('file:' + localPath, { readOnly: true });
  } catch (e) {
    console.error(`Cannot open local database at ${localPath}:`, e.message);
    process.exit(1);
  }
  const remoteDb = new DatabaseSync(remoteUrl, { authToken: remoteToken });

  try {
    remoteDb.exec('PRAGMA foreign_keys = ON;');
  } catch (e) { /* ignore on remote */ }

  console.log(`Local : ${localPath}`);
  console.log(`Remote: ${remoteUrl}\n`);

  let totalCopied = 0;
  const skipped = [];

  for (const table of TABLE_ORDER) {
    const localCols = columns(localDb, table);
    const remoteCols = columns(remoteDb, table);
    const sharedCols = localCols.filter((c) => remoteCols.includes(c));
    if (sharedCols.length === 0) {
      skipped.push(`${table} (no shared columns)`);
      console.log(`- ${table}: skipped (no shared columns)`);
      continue;
    }

    const rows = localDb.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) {
      console.log(`- ${table}: 0 rows, nothing to copy`);
      continue;
    }

    if (table === 'users') {
      // Remote has the seeded admin; merge by unique username.
      const existing = new Set(
        remoteDb.prepare('SELECT username FROM users').all().map((u) => u.username)
      );
      const toCopy = rows.filter((r) => !existing.has(r.username));
      if (toCopy.length === 0) {
        console.log(`- users: all usernames already on remote, nothing to add`);
        continue;
      }
      const cols = sharedCols.join(',');
      const ph = sharedCols.map(() => '?').join(',');
      remoteDb.exec('BEGIN');
      try {
        // Note: on remote (Hrana) connections the statement must be prepared
        // AFTER BEGIN or the transaction is silently dropped.
        const insert = remoteDb.prepare(`INSERT INTO users (${cols}) VALUES (${ph})`);
        for (const row of toCopy) insert.run(...sharedCols.map((c) => row[c]));
        remoteDb.exec('COMMIT');
        totalCopied += toCopy.length;
        console.log(`- users: copied ${toCopy.length} row(s) (merged by username)`);
      } catch (e) {
        try {
          remoteDb.exec('ROLLBACK');
        } catch (e2) { /* ignore */ }
        skipped.push(`${table} (${e.message})`);
        console.error(`- users: FAILED - ${e.message}`);
      }
      continue;
    }

    const remoteCount = remoteDb
      .prepare(`SELECT COUNT(*) AS c FROM ${table}`)
      .get().c;
    if (remoteCount > 0) {
      skipped.push(`${table} (remote already has ${remoteCount} rows)`);
      console.log(`- ${table}: SKIPPED (remote already has ${remoteCount} row(s))`);
      continue;
    }

    const cols = sharedCols.join(',');
    const ph = sharedCols.map(() => '?').join(',');
    remoteDb.exec('BEGIN');
    try {
      // On remote (Hrana) connections the statement must be prepared AFTER
      // BEGIN or the transaction is silently dropped.
      const insert = remoteDb.prepare(`INSERT INTO ${table} (${cols}) VALUES (${ph})`);
      for (const row of rows) insert.run(...sharedCols.map((c) => row[c]));
      remoteDb.exec('COMMIT');
      totalCopied += rows.length;
      console.log(`- ${table}: copied ${rows.length} rows`);
    } catch (e) {
      try {
        remoteDb.exec('ROLLBACK');
      } catch (e2) { /* ignore */ }
      skipped.push(`${table} (${e.message})`);
      console.error(`- ${table}: FAILED - ${e.message}`);
    }
  }

  console.log(`\nDone. ${totalCopied} row(s) copied.`);
  if (skipped.length) {
    console.log('Skipped:');
    skipped.forEach((s) => console.log(`  - ${s}`));
  }

  localDb.close();
  remoteDb.close();
}

if (process.argv.includes('--force')) {
  main();
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question(
    'This copies your LOCAL database into Turso. Continue? (y/N) ',
    (answer) => {
      rl.close();
      if (answer.toLowerCase() === 'y') main();
      else console.log('Aborted.');
    }
  );
}
