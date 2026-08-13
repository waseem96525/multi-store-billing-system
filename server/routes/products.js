const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate, attachStore);

router.get('/', (req, res) => {
  const { q, category_id, low_stock } = req.query;
  let sql = `SELECT p.*, c.name AS category_name,
             ps.stock_qty, ps.reorder_level
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
             WHERE 1=1`;
  const params = [req.storeId];
  if (q) {
    sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category_id) {
    sql += ' AND p.category_id = ?';
    params.push(category_id);
  }
  if (low_stock === '1') {
    sql += ' AND ps.stock_qty <= ps.reorder_level';
  }
  sql += ' ORDER BY p.name LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  res.json({ products: rows });
});

// Quick lookup by exact barcode or SKU (used by the POS scanner)
router.get('/barcode/:code', (req, res) => {
  const code = req.params.code;
  const product = db
    .prepare(
      `SELECT p.*, ps.stock_qty, ps.reorder_level
       FROM products p
       LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
       WHERE p.barcode = ? OR p.sku = ? LIMIT 1`
    )
    .get(req.storeId, code, code);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

// Top-selling products for the POS "Quick Add" shelf (scoped to current store)
router.get('/frequent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 50);
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name, ps.stock_qty, ps.reorder_level,
              COALESCE(SUM(ii.qty), 0) AS sold_qty
       FROM products p
       LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
       LEFT JOIN invoice_items ii ON ii.product_id = p.id
       LEFT JOIN invoices i ON i.id = ii.invoice_id AND i.store_id = ?
       LEFT JOIN categories c ON p.category_id = c.id
       GROUP BY p.id
       ORDER BY sold_qty DESC, p.name ASC
       LIMIT ?`
    )
    .all(req.storeId, req.storeId, limit);
  res.json({ products: rows });
});

router.post('/', authorize('admin', 'inventory'), (req, res) => {
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
    description,
    brand,
    hsn_code,
    mrp,
    expiry_date,
    location,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });

  db.exec('BEGIN');
  try {
    // NOTE: prepare statements after BEGIN - required for remote (Hrana/Turso) transactions
    const insertProduct = db.prepare(
      `INSERT INTO products
       (name, sku, barcode, category_id, unit, cost_price, selling_price, tax_percent,
        description, brand, hsn_code, mrp, expiry_date, location)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const insertStock = db.prepare(
      `INSERT INTO product_stock (product_id, store_id, stock_qty, reorder_level)
       VALUES (?,?,?,?)
       ON CONFLICT(product_id, store_id) DO UPDATE SET
         stock_qty = excluded.stock_qty,
         reorder_level = excluded.reorder_level`
    );
    const info = insertProduct.run(
      name,
      sku || null,
      barcode || null,
      category_id || null,
      unit || 'pcs',
      cost_price || 0,
      selling_price || 0,
      tax_percent || 0,
      description || null,
      brand || null,
      hsn_code || null,
      mrp || 0,
      expiry_date || null,
      location || null
    );
    // Give every existing store a row (zero stock), then set the creating store's stock
    db.exec(
      `INSERT OR IGNORE INTO product_stock (product_id, store_id, stock_qty, reorder_level)
       SELECT ${info.lastInsertRowid}, id, 0, 0 FROM stores`
    );
    insertStock.run(info.lastInsertRowid, req.storeId, stock_qty || 0, reorder_level || 0);
    db.exec('COMMIT');
    const product = db
      .prepare(
        `SELECT p.*, ps.stock_qty, ps.reorder_level
         FROM products p
         LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
         WHERE p.id = ?`
      )
      .get(req.storeId, info.lastInsertRowid);
    logActivity(req.user, 'product_created', `Created "${product.name}" (sku ${product.sku || '-'})`, req.storeId);
    res.status(201).json({ product });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', authorize('admin', 'inventory'), (req, res) => {
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
    description,
    brand,
    hsn_code,
    mrp,
    expiry_date,
    location,
  } = req.body || {};

  db.exec('BEGIN');
  try {
    const updateProduct = db.prepare(
      `UPDATE products SET
         name=?, sku=?, barcode=?, category_id=?, unit=?,
         cost_price=?, selling_price=?, tax_percent=?,
         description=?, brand=?, hsn_code=?, mrp=?, expiry_date=?, location=?,
         updated_at=datetime('now')
       WHERE id=?`
    );
    const updateStock = db.prepare(
      `INSERT INTO product_stock (product_id, store_id, stock_qty, reorder_level)
       VALUES (?,?,?,?)
       ON CONFLICT(product_id, store_id) DO UPDATE SET
         stock_qty = excluded.stock_qty,
         reorder_level = excluded.reorder_level`
    );
    updateProduct.run(
      name ?? existing.name,
      sku ?? existing.sku,
      barcode ?? existing.barcode,
      category_id ?? existing.category_id,
      unit ?? existing.unit,
      cost_price ?? existing.cost_price,
      selling_price ?? existing.selling_price,
      tax_percent ?? existing.tax_percent,
      description ?? existing.description,
      brand ?? existing.brand,
      hsn_code ?? existing.hsn_code,
      mrp ?? existing.mrp,
      expiry_date ?? existing.expiry_date,
      location ?? existing.location,
      id
    );
    const curStock = db
      .prepare('SELECT * FROM product_stock WHERE product_id = ? AND store_id = ?')
      .get(id, req.storeId);
    updateStock.run(
      id,
      req.storeId,
      stock_qty ?? (curStock ? curStock.stock_qty : 0),
      reorder_level ?? (curStock ? curStock.reorder_level : 0)
    );
    db.exec('COMMIT');
    const product = db
      .prepare(
        `SELECT p.*, ps.stock_qty, ps.reorder_level
         FROM products p
         LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
         WHERE p.id = ?`
      )
      .get(req.storeId, id);
    logActivity(req.user, 'product_updated', `Updated "${product.name}"`, req.storeId);
    res.json({ product });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', authorize('admin', 'inventory'), (req, res) => {
  try {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM product_stock WHERE product_id = ?').run(req.params.id);
      const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
      db.exec('COMMIT');
      if (info.changes === 0) return res.status(404).json({ error: 'Product not found' });
      logActivity(req.user, 'product_deleted', `Deleted product id ${req.params.id}`, req.storeId);
      res.json({ success: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    if (String(e.message).includes('FOREIGN KEY')) {
      return res
        .status(400)
        .json({ error: 'Cannot delete product: it has sales or purchase history' });
    }
    throw e;
  }
});

router.get('/categories/all', (req, res) => {
  res.json({ categories: db.prepare('SELECT * FROM categories ORDER BY name').all() });
});

router.post('/categories', authorize('admin', 'inventory'), (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    logActivity(req.user, 'category_created', `Created category "${name}"`, req.storeId);
    res.status(201).json({ category: { id: info.lastInsertRowid, name } });
  } catch (e) {
    res.status(409).json({ error: 'Category already exists' });
  }
});

router.put('/categories/:id', authorize('admin', 'inventory'), (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare('UPDATE categories SET name = ? WHERE id = ?')
    .run(name, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Category not found' });
  logActivity(req.user, 'category_updated', `Renamed category id ${req.params.id} to "${name}"`, req.storeId);
  res.json({ category: { id: Number(req.params.id), name } });
});

router.delete('/categories/:id', authorize('admin', 'inventory'), (req, res) => {
  try {
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(
        req.params.id
      );
      const info = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
      db.exec('COMMIT');
      if (info.changes === 0) return res.status(404).json({ error: 'Category not found' });
      logActivity(req.user, 'category_deleted', `Deleted category id ${req.params.id}`, req.storeId);
      res.json({ success: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
