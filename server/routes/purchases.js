const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate, attachStore);

// Auto-reorder suggestions: products below/at their reorder level for this store,
// with a suggested order quantity and estimated cost.
router.get('/suggestions', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.barcode, p.cost_price, p.selling_price, p.unit,
              ps.stock_qty, ps.reorder_level, c.name AS category_name
       FROM products p
       LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE ps.stock_qty <= ps.reorder_level
       ORDER BY ps.stock_qty - ps.reorder_level ASC, p.name ASC`
    )
    .all(req.storeId);
  const suggestions = rows.map((p) => {
    const suggested_qty = Math.max(1, Math.ceil(p.reorder_level * 2 - p.stock_qty));
    return {
      ...p,
      suggested_qty,
      est_cost: Number((p.cost_price || 0) * suggested_qty).toFixed(2),
    };
  });
  const total_est_cost = suggestions.reduce(
    (sum, s) => sum + Number(s.est_cost),
    0
  );
  res.json({ suggestions, count: suggestions.length, total_est_cost });
});

router.post('/', authorize('admin', 'inventory'), (req, res) => {
  const { supplier_id, invoice_ref, items } = req.body || {};
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }

  // Batch reads into a few round trips and do all writes in one transaction
  // script - keeps remote (Turso) checkout fast.
  const ids = [
    ...new Set(
      items.map((it) => Number(it.product_id)).filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
  if (ids.length === 0) return res.status(400).json({ error: 'Invalid items' });
  const ph = ids.map(() => '?').join(',');

  let products, supplier;
  try {
    products = db
      .prepare(`SELECT * FROM products WHERE id IN (${ph})`)
      .all(...ids);
    supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(supplier_id));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!supplier) return res.status(400).json({ error: 'Supplier not found' });
  const productMap = new Map(products.map((p) => [p.id, p]));

  let total = 0;
  const processed = [];
  for (const it of items) {
    const pid = Number(it.product_id);
    const product = productMap.get(pid);
    if (!product) return res.status(400).json({ error: 'Product not found: ' + pid });
    const qty = Number(it.qty);
    if (!(qty > 0)) return res.status(400).json({ error: 'Invalid quantity for ' + product.name });
    const cost = Number(it.cost_price ?? product.cost_price);
    total += cost * qty;
    processed.push({ product_id: pid, qty, cost_price: cost });
  }

  const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const num = (n) => (Number.isFinite(Number(n)) ? String(Number(n)) : '0');

  const stockAgg = new Map();
  for (const p of processed) stockAgg.set(p.product_id, (stockAgg.get(p.product_id) || 0) + p.qty);
  const ensureStock =
    `INSERT OR IGNORE INTO product_stock (product_id, store_id, stock_qty, reorder_level) VALUES ` +
    [...stockAgg.keys()].map((pid) => `(${pid}, ${req.storeId}, 0, 0)`).join(', ') + ';';
  const stockUpdate =
    `UPDATE product_stock SET stock_qty = stock_qty + CASE product_id ` +
    [...stockAgg].map(([pid, qty]) => `WHEN ${pid} THEN ${num(qty)}`).join(' ') +
    ` END WHERE store_id = ${req.storeId} AND product_id IN (${[...stockAgg.keys()].join(',')});`;

  const itemsInsert =
    `INSERT INTO purchase_items (purchase_id, product_id, qty, cost_price)
     SELECT ` +
    processed
      .map((p) => `?purchaseId?, ${p.product_id}, ${num(p.qty)}, ${num(p.cost_price)}`)
      .join(' UNION ALL SELECT ') +
    ';';

  const purchaseInsert =
    `INSERT INTO purchases (supplier_id, invoice_ref, total_amount, created_by, store_id)
     VALUES (${Number(supplier_id)}, ${invoice_ref ? esc(invoice_ref) : 'NULL'}, ${num(total)}, ${req.user.id}, ${req.storeId});`;

  // Writes in 3 round trips: BEGIN+insert, read row id, then rest+COMMIT
  let purchaseId;
  try {
    db.exec('BEGIN;\n' + purchaseInsert);
    purchaseId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.exec(
      [
        ensureStock,
        stockUpdate,
        itemsInsert.replace(/\?purchaseId\?/g, purchaseId),
        `UPDATE suppliers SET outstanding_balance = outstanding_balance + ${num(total)} WHERE id = ${Number(supplier_id)};`,
        'COMMIT;',
      ].join('\n')
    );
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (er) { /* ignore */ }
    return res.status(400).json({ error: e.message });
  }

  logActivity(
    req.user,
    'purchase',
    `Purchase #${purchaseId} · ${processed.length} item(s) · ₹${total.toFixed(2)}`,
    req.storeId
  );
  res.status(201).json({
    purchase: { id: purchaseId, supplier_id, invoice_ref, total_amount: total },
  });
});

router.get('/', (req, res) => {
  const purchases = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.store_id = ?
       ORDER BY p.id DESC LIMIT 200`
    )
    .all(req.storeId);
  res.json({ purchases });
});

router.get('/:id', (req, res) => {
  const purchase = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.id = ? AND p.store_id = ?`
    )
    .get(req.params.id, req.storeId);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  const items = db
    .prepare(
      `SELECT pi.*, p.name AS product_name FROM purchase_items pi
       LEFT JOIN products p ON pi.product_id = p.id
       WHERE pi.purchase_id = ?`
    )
    .all(purchase.id);
  res.json({ purchase, items });
});

module.exports = router;
