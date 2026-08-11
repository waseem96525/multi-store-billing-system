const path = require('path');
const fs = require('fs');
const DatabaseSync = require('libsql');
const { hashPassword } = require('../utils/auth');

const dbDir = path.join(__dirname, '..', 'data');
try {
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
} catch (e) {
  // read-only filesystem (e.g. Vercel serverless) - local file DB not used there
}

const dbUrl = process.env.TURSO_URL || 'file:' + path.join(dbDir, 'shop.db');
const dbAuthToken = process.env.TURSO_AUTH_TOKEN;
const db = dbAuthToken
  ? new DatabaseSync(dbUrl, { authToken: dbAuthToken })
  : new DatabaseSync(dbUrl);
try { db.exec('PRAGMA journal_mode = WAL;'); } catch (e) { /* remote may not support WAL */ }
try { db.exec('PRAGMA foreign_keys = ON;'); } catch (e) { /* ignore on remote */ }

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  category_id INTEGER,
  unit TEXT DEFAULT 'pcs',
  cost_price REAL NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0,
  stock_qty REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'cash',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  change_qty REAL NOT NULL,
  reason TEXT,
  adjusted_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  outstanding_balance REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  invoice_ref TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS held_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  label TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  gstin TEXT,
  receipt_footer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_stock (
  product_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  stock_qty REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, store_id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  note TEXT,
  expense_date TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  invoice_id INTEGER NOT NULL,
  reason TEXT,
  total_refund REAL NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  FOREIGN KEY (return_id) REFERENCES returns(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
`);

// Store-related migrations
const ensureColumn = (table, column, ddl) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};

ensureColumn('users', 'store_id', 'store_id INTEGER NOT NULL DEFAULT 1');
ensureColumn('invoices', 'store_id', 'store_id INTEGER NOT NULL DEFAULT 1');
ensureColumn('purchases', 'store_id', 'store_id INTEGER NOT NULL DEFAULT 1');
ensureColumn('held_bills', 'store_id', 'store_id INTEGER NOT NULL DEFAULT 1');
ensureColumn('stock_adjustments', 'store_id', 'store_id INTEGER NOT NULL DEFAULT 1');
ensureColumn('invoice_items', 'cost_price', 'cost_price REAL NOT NULL DEFAULT 0');

// Seed default store
const storeCount = db.prepare('SELECT COUNT(*) AS c FROM stores').get().c;
if (storeCount === 0) {
  db.prepare('INSERT INTO stores (name) VALUES (?)').run('Main Store');
}

// Backfill product_stock from legacy products.stock_qty / reorder_level
db.exec(`
INSERT OR IGNORE INTO product_stock (product_id, store_id, stock_qty, reorder_level)
SELECT id, 1, stock_qty, reorder_level FROM products;
`);

// Backfill invoice_items.cost_price from current product cost where missing
db.exec(`
UPDATE invoice_items SET cost_price =
  (SELECT p.cost_price FROM products p WHERE p.id = invoice_items.product_id)
WHERE cost_price = 0 AND EXISTS (SELECT 1 FROM products p WHERE p.id = invoice_items.product_id);
`);

// Add optional columns to invoices for partial payments / credit billing
const invoiceCols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
if (!invoiceCols.includes('amount_paid')) {
  db.exec('ALTER TABLE invoices ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0');
}
if (!invoiceCols.includes('status')) {
  db.exec("ALTER TABLE invoices ADD COLUMN status TEXT NOT NULL DEFAULT 'paid'");
}
if (!invoiceCols.includes('due_date')) {
  db.exec('ALTER TABLE invoices ADD COLUMN due_date TEXT');
}

const adminCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (adminCount === 0) {
  db.prepare(
    'INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)'
  ).run('Admin', 'admin', hashPassword('admin123'), 'admin');
  // eslint-disable-next-line no-console
  console.log('Seeded default admin -> username: admin  password: admin123');
}

module.exports = db;
