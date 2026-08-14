const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate, attachStore);

// List transfers (outgoing from this store, plus incoming to it)
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, fs.name AS from_store_name, ts.name AS to_store_name,
              u.name AS created_by_name,
              (SELECT COUNT(*) FROM stock_transfer_items ti WHERE ti.transfer_id = t.id) AS item_count
       FROM stock_transfers t
       LEFT JOIN stores fs ON fs.id = t.from_store_id
       LEFT JOIN stores ts ON ts.id = t.to_store_id
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.from_store_id = ? OR t.to_store_id = ?
       ORDER BY t.id DESC LIMIT 200`
    )
    .all(req.storeId, req.storeId);
  const itemStmt = db.prepare(
    `SELECT ti.*, p.name AS product_name, p.sku FROM stock_transfer_items ti
     LEFT JOIN products p ON p.id = ti.product_id
     WHERE ti.transfer_id = ?`
  );
  for (const r of rows) r.items = itemStmt.all(r.id);
  res.json({ transfers: rows });
});

// Create a transfer from the current store to another store
router.post('/', authorize('admin', 'inventory'), (req, res) => {
  const { to_store_id, note, items } = req.body || {};
  if (!to_store_id) return res.status(400).json({ error: 'to_store_id required' });
  if (Number(to_store_id) === Number(req.storeId)) {
    return res.status(400).json({ error: 'Destination store must be different' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(Number(to_store_id));
  if (!store) return res.status(404).json({ error: 'Destination store not found' });

  // Batch reads and do every write in one transaction script (remote Turso friendly)
  const ids = [
    ...new Set(
      items.map((it) => Number(it.product_id)).filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
  if (ids.length === 0) return res.status(400).json({ error: 'Invalid items' });
  const ph = ids.map(() => '?').join(',');

  let products, stockRows;
  try {
    products = db
      .prepare(`SELECT * FROM products WHERE id IN (${ph})`)
      .all(...ids);
    stockRows = db
      .prepare(
        `SELECT product_id, stock_qty FROM product_stock WHERE store_id = ? AND product_id IN (${ph})`
      )
      .all(req.storeId, ...ids);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const productMap = new Map(products.map((p) => [p.id, p]));
  const stockMap = new Map(stockRows.map((r) => [r.product_id, r.stock_qty]));

  const processed = [];
  for (const it of items) {
    const pid = Number(it.product_id);
    const product = productMap.get(pid);
    if (!product) return res.status(400).json({ error: 'Product not found: ' + pid });
    const qty = Number(it.qty);
    if (!(qty > 0)) return res.status(400).json({ error: 'Invalid quantity for ' + product.name });
    const available = stockMap.get(pid) || 0;
    if (available < qty) {
      return res.status(400).json({ error: `Insufficient stock for ${product.name} (${available} available)` });
    }
    processed.push({ product_id: pid, qty });
  }

  const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const num = (n) => (Number.isFinite(Number(n)) ? String(Number(n)) : '0');

  const outAgg = new Map();
  for (const p of processed) outAgg.set(p.product_id, (outAgg.get(p.product_id) || 0) + p.qty);
  const outIds = [...outAgg.keys()].join(',');
  const decrement =
    `UPDATE product_stock SET stock_qty = MAX(0, stock_qty - CASE product_id ` +
    [...outAgg].map(([pid, qty]) => `WHEN ${pid} THEN ${num(qty)}`).join(' ') +
    ` END) WHERE store_id = ${req.storeId} AND product_id IN (${outIds});`;
  const ensureIn =
    `INSERT OR IGNORE INTO product_stock (product_id, store_id, stock_qty, reorder_level) VALUES ` +
    outAgg.keys().map((pid) => `(${pid}, ${Number(to_store_id)}, 0, 0)`).join(', ') + ';';
  const increment =
    `UPDATE product_stock SET stock_qty = stock_qty + CASE product_id ` +
    [...outAgg].map(([pid, qty]) => `WHEN ${pid} THEN ${num(qty)}`).join(' ') +
    ` END WHERE store_id = ${Number(to_store_id)} AND product_id IN (${outIds});`;

  const itemsInsert =
    `INSERT INTO stock_transfer_items (transfer_id, product_id, qty)
     SELECT ` +
    processed
      .map((p) => `?transferId?, ${p.product_id}, ${num(p.qty)}`)
      .join(' UNION ALL SELECT ') +
    ';';

  const transferInsert =
    `INSERT INTO stock_transfers (from_store_id, to_store_id, note, created_by)
     VALUES (${req.storeId}, ${Number(to_store_id)}, ${note ? esc(note) : 'NULL'}, ${req.user.id});`;

  // Writes in 3 round trips: BEGIN+insert, read row id, then rest+COMMIT
  let transferId;
  try {
    db.exec('BEGIN;\n' + transferInsert);
    transferId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.exec(
      [
        decrement,
        ensureIn,
        increment,
        itemsInsert.replace(/\?transferId\?/g, transferId),
        'COMMIT;',
      ].join('\n')
    );
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (er) { /* ignore */ }
    return res.status(400).json({ error: e.message });
  }

  logActivity(
    req.user,
    'transfer',
    `Transfer #${transferId} · ${processed.length} item(s) · store ${req.storeId} → ${to_store_id}`,
    req.storeId
  );
  res.status(201).json({ transfer: { id: transferId, to_store_id, note, item_count: processed.length } });
});

module.exports = router;
