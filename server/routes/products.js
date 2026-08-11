const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const { q, category_id, low_stock } = req.query;
  let sql = `SELECT p.*, c.name AS category_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category_id) {
    sql += ' AND p.category_id = ?';
    params.push(category_id);
  }
  if (low_stock === '1') {
    sql += ' AND p.stock_qty <= p.reorder_level';
  }
  sql += ' ORDER BY p.name LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  res.json({ products: rows });
});

// Quick lookup by exact barcode or SKU (used by the POS scanner)
router.get('/barcode/:code', authenticate, (req, res) => {
  const code = req.params.code;
  const product = db
    .prepare('SELECT * FROM products WHERE barcode = ? OR sku = ? LIMIT 1')
    .get(code, code);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

// Top-selling products for the POS "Quick Add" shelf
router.get('/frequent', authenticate, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 50);
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name, COALESCE(SUM(ii.qty), 0) AS sold_qty
       FROM products p
       LEFT JOIN invoice_items ii ON ii.product_id = p.id
       LEFT JOIN categories c ON p.category_id = c.id
       GROUP BY p.id
       ORDER BY sold_qty DESC, p.name ASC
       LIMIT ?`
    )
    .all(limit);
  res.json({ products: rows });
});

router.post('/', authenticate, authorize('admin', 'inventory'), (req, res) => {
  const {
    name,
    sku,
    barcode,
    category_id,
    unit,
    cost_price,
    selling_price,
    tax_percent,
    stock_qty,
    reorder_level,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare(
      `INSERT INTO products
       (name, sku, barcode, category_id, unit, cost_price, selling_price, tax_percent, stock_qty, reorder_level)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      name,
      sku || null,
      barcode || null,
      category_id || null,
      unit || 'pcs',
      cost_price || 0,
      selling_price || 0,
      tax_percent || 0,
      stock_qty || 0,
      reorder_level || 0
    );
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ product });
});

router.put('/:id', authenticate, authorize('admin', 'inventory'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const {
    name,
    sku,
    barcode,
    category_id,
    unit,
    cost_price,
    selling_price,
    tax_percent,
    stock_qty,
    reorder_level,
  } = req.body || {};
  db.prepare(
    `UPDATE products SET
       name=?, sku=?, barcode=?, category_id=?, unit=?,
       cost_price=?, selling_price=?, tax_percent=?, stock_qty=?, reorder_level=?,
       updated_at=datetime('now')
     WHERE id=?`
  ).run(
    name ?? existing.name,
    sku ?? existing.sku,
    barcode ?? existing.barcode,
    category_id ?? existing.category_id,
    unit ?? existing.unit,
    cost_price ?? existing.cost_price,
    selling_price ?? existing.selling_price,
    tax_percent ?? existing.tax_percent,
    stock_qty ?? existing.stock_qty,
    reorder_level ?? existing.reorder_level,
    id
  );
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ product });
});

router.delete('/:id', authenticate, authorize('admin', 'inventory'), (req, res) => {
  try {
    const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ success: true });
  } catch (e) {
    if (String(e.message).includes('FOREIGN KEY')) {
      return res
        .status(400)
        .json({ error: 'Cannot delete product: it has sales or purchase history' });
    }
    throw e;
  }
});

router.get('/categories/all', authenticate, (req, res) => {
  res.json({ categories: db.prepare('SELECT * FROM categories ORDER BY name').all() });
});

router.post('/categories', authenticate, authorize('admin', 'inventory'), (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.status(201).json({ category: { id: info.lastInsertRowid, name } });
  } catch (e) {
    res.status(409).json({ error: 'Category already exists' });
  }
});

module.exports = router;
