const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');

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
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(to_store_id);
  if (!store) return res.status(404).json({ error: 'Destination store not found' });

  db.exec('BEGIN');
  try {
    // NOTE: prepare statements after BEGIN - required for remote (Hrana/Turso) transactions
    const getStock = db.prepare(
      'SELECT stock_qty FROM product_stock WHERE product_id = ? AND store_id = ?'
    );
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
    const decrement = db.prepare(
      'UPDATE product_stock SET stock_qty = stock_qty - ? WHERE product_id = ? AND store_id = ?'
    );
    const increment = db.prepare(
      `INSERT INTO product_stock (product_id, store_id, stock_qty, reorder_level)
       VALUES (?,?,?,0)
       ON CONFLICT(product_id, store_id) DO UPDATE SET
         stock_qty = stock_qty + excluded.stock_qty`
    );
    const insertTransfer = db.prepare(
      'INSERT INTO stock_transfers (from_store_id, to_store_id, note, created_by) VALUES (?,?,?,?)'
    );
    const insertItem = db.prepare(
      'INSERT INTO stock_transfer_items (transfer_id, product_id, qty) VALUES (?,?,?)'
    );

    const processed = [];
    for (const it of items) {
      const product = getProduct.get(it.product_id);
      if (!product) throw new Error('Product not found: ' + it.product_id);
      const qty = Number(it.qty);
      if (!(qty > 0)) throw new Error('Invalid quantity for ' + product.name);
      const stockRow = getStock.get(it.product_id, req.storeId);
      const available = stockRow ? stockRow.stock_qty : 0;
      if (available < qty) {
        throw new Error(
          `Insufficient stock for ${product.name} (${available} available)`
        );
      }
      processed.push({ product_id: product.id, qty });
    }

    const info = insertTransfer.run(req.storeId, to_store_id, note || null, req.user.id);
    const transferId = info.lastInsertRowid;
    for (const p of processed) {
      insertItem.run(transferId, p.product_id, p.qty);
      decrement.run(p.qty, p.product_id, req.storeId);
      increment.run(p.product_id, to_store_id, p.qty);
    }
    db.exec('COMMIT');
    res.status(201).json({ transfer: { id: transferId, to_store_id, note, item_count: processed.length } });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
