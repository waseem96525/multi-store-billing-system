const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate);
router.use(attachStore);

router.get('/', (req, res) => {
  const { from, to, category } = req.query;
  let sql = 'SELECT e.*, u.name AS created_by_name FROM expenses e LEFT JOIN users u ON u.id = e.created_by WHERE e.store_id = ?';
  const params = [req.storeId];
  if (from) {
    sql += ' AND date(e.expense_date) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(e.expense_date) <= date(?)';
    params.push(to);
  }
  if (category) {
    sql += ' AND e.category = ?';
    params.push(category);
  }
  sql += ' ORDER BY e.expense_date DESC, e.id DESC';
  const expenses = db.prepare(sql).all(...params);
  const categories = db
    .prepare('SELECT DISTINCT category FROM expenses WHERE store_id = ? ORDER BY category')
    .all(req.storeId)
    .map((r) => r.category);
  res.json({ expenses, categories });
});

router.post('/', authorize('admin', 'inventory'), (req, res) => {
  const { category, amount, note, expense_date } = req.body || {};
  if (!category) return res.status(400).json({ error: 'category required' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Valid amount required' });
  const info = db
    .prepare(
      `INSERT INTO expenses (store_id, category, amount, note, expense_date, created_by)
       VALUES (?,?,?,?,?,?)`
    )
    .run(
      req.storeId,
      category,
      Number(amount),
      note || null,
      expense_date || new Date().toISOString().slice(0, 10),
      req.user.id
    );
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
  logActivity(
    req.user,
    'expense',
    `${category} · ₹${Number(amount).toFixed(2)}${note ? ` · ${note}` : ''}`,
    req.storeId
  );
  res.status(201).json({ expense });
});

router.delete('/:id', authorize('admin'), (req, res) => {
  const info = db
    .prepare('DELETE FROM expenses WHERE id = ? AND store_id = ?')
    .run(req.params.id, req.storeId);
  if (info.changes === 0) return res.status(404).json({ error: 'Expense not found' });
  logActivity(req.user, 'expense_deleted', `Deleted expense id ${req.params.id}`, req.storeId);
  res.json({ success: true });
});

module.exports = router;
