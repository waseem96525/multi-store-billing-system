const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');

const router = express.Router();

router.use(authenticate, attachStore);

const esc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const ENTITIES = {
  products: {
    file: 'products.csv',
    sql: `SELECT p.id, p.name, p.brand, p.sku, p.barcode, c.name AS category, p.unit,
                 p.cost_price, p.selling_price, p.mrp, p.tax_percent, ps.stock_qty, ps.reorder_level,
                 p.hsn_code, p.expiry_date, p.location
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
          ORDER BY p.name`,
    columns: [
      ['id', 'ID'], ['name', 'Name'], ['brand', 'Brand'], ['sku', 'SKU'], ['barcode', 'Barcode'],
      ['category', 'Category'], ['unit', 'Unit'], ['cost_price', 'Cost Price'], ['selling_price', 'Selling Price'],
      ['mrp', 'MRP'], ['tax_percent', 'Tax %'], ['stock_qty', 'Stock'], ['reorder_level', 'Reorder Level'],
      ['hsn_code', 'HSN Code'], ['expiry_date', 'Expiry Date'], ['location', 'Location'],
    ],
  },
  invoices: {
    file: 'invoices.csv',
    sql: `SELECT i.id, i.invoice_no, i.created_at, u.name AS cashier, i.subtotal, i.discount,
                 i.tax_total, i.grand_total, i.payment_mode, i.status, i.amount_paid,
                 COALESCE(c.name, 'Walk-in') AS customer
          FROM invoices i
          LEFT JOIN users u ON i.created_by = u.id
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.store_id = ?
          ORDER BY i.id DESC`,
    columns: [
      ['id', 'ID'], ['invoice_no', 'Invoice No'], ['created_at', 'Date'], ['cashier', 'Cashier'],
      ['subtotal', 'Subtotal'], ['discount', 'Discount'], ['tax_total', 'Tax'], ['grand_total', 'Grand Total'],
      ['payment_mode', 'Payment Mode'], ['status', 'Status'], ['amount_paid', 'Amount Paid'], ['customer', 'Customer'],
    ],
  },
  customers: {
    file: 'customers.csv',
    storeScoped: false,
    sql: 'SELECT id, name, phone, email, address, created_at FROM customers ORDER BY name',
    columns: [
      ['id', 'ID'], ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['created_at', 'Created'],
    ],
  },
  suppliers: {
    file: 'suppliers.csv',
    storeScoped: false,
    sql: 'SELECT id, name, phone, email, address, outstanding_balance FROM suppliers ORDER BY name',
    columns: [
      ['id', 'ID'], ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['outstanding_balance', 'Outstanding Balance'],
    ],
  },
  purchases: {
    file: 'purchases.csv',
    sql: `SELECT p.id, p.created_at, s.name AS supplier, p.invoice_ref, p.total_amount, u.name AS created_by
          FROM purchases p
          LEFT JOIN suppliers s ON p.supplier_id = s.id
          LEFT JOIN users u ON p.created_by = u.id
          WHERE p.store_id = ?
          ORDER BY p.id DESC`,
    columns: [
      ['id', 'ID'], ['created_at', 'Date'], ['supplier', 'Supplier'], ['invoice_ref', 'Invoice Ref'],
      ['total_amount', 'Total Amount'], ['created_by', 'Created By'],
    ],
  },
  expenses: {
    file: 'expenses.csv',
    sql: `SELECT e.id, e.expense_date, e.category, e.amount, e.note, u.name AS created_by
          FROM expenses e
          LEFT JOIN users u ON e.created_by = u.id
          WHERE e.store_id = ?
          ORDER BY e.expense_date DESC, e.id DESC`,
    columns: [
      ['id', 'ID'], ['expense_date', 'Date'], ['category', 'Category'], ['amount', 'Amount'],
      ['note', 'Note'], ['created_by', 'Created By'],
    ],
  },
  returns: {
    file: 'returns.csv',
    sql: `SELECT r.id, r.created_at, i.invoice_no, r.reason, r.total_refund, u.name AS created_by
          FROM returns r
          LEFT JOIN invoices i ON r.invoice_id = i.id
          LEFT JOIN users u ON r.created_by = u.id
          WHERE r.store_id = ?
          ORDER BY r.id DESC`,
    columns: [
      ['id', 'ID'], ['created_at', 'Date'], ['invoice_no', 'Invoice'], ['reason', 'Reason'],
      ['total_refund', 'Refund Amount'], ['created_by', 'Created By'],
    ],
  },
  transfers: {
    file: 'transfers.csv',
    sql: `SELECT t.id, t.created_at, fs.name AS from_store, ts.name AS to_store, t.note, u.name AS created_by,
                 (SELECT COUNT(*) FROM stock_transfer_items ti WHERE ti.transfer_id = t.id) AS item_count
          FROM stock_transfers t
          LEFT JOIN stores fs ON t.from_store_id = fs.id
          LEFT JOIN stores ts ON t.to_store_id = ts.id
          LEFT JOIN users u ON t.created_by = u.id
          WHERE t.from_store_id = ? OR t.to_store_id = ?
          ORDER BY t.id DESC`,
    columns: [
      ['id', 'ID'], ['created_at', 'Date'], ['from_store', 'From Store'], ['to_store', 'To Store'],
      ['note', 'Note'], ['created_by', 'Created By'], ['item_count', 'Item Count'],
    ],
  },
};

router.get('/:entity', (req, res) => {
  const entity = ENTITIES[req.params.entity];
  if (!entity) return res.status(400).json({ error: 'Unknown export entity' });
  const rows = entity.storeScoped
    ? db.prepare(entity.sql).all(req.storeId)
    : db.prepare(entity.sql).all();
  const header = entity.columns.map(([, label]) => label);
  const lines = [header.map(esc).join(',')];
  for (const row of rows) {
    lines.push(entity.columns.map(([key]) => esc(row[key])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${entity.file}"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

module.exports = router;
