import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { listExpenses, createExpense, deleteExpense } from '../api/expenses';
import { exportCsv } from '../api/export';
import { can, PERM } from '../utils/permissions';

const CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries',
  'Transport',
  'Supplies',
  'Maintenance',
  'Marketing',
  'Other',
];

const EMPTY = { category: '', amount: '', note: '', expense_date: new Date().toISOString().slice(0, 10) };

export default function Expenses() {
  const user = useSelector((s) => s.auth.user);
  const canDelete = can(user, PERM.EXPENSES_DELETE);
  const [expenses, setExpenses] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const data = await listExpenses();
      setExpenses(data.expenses);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await createExpense(form);
      setForm(EMPTY);
      setMsg('Expense recorded');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await deleteExpense(id);
      load();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete');
    }
  };

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-800">Expenses</h1>
        <div className="flex items-center gap-2 self-start">
          <button
            className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200"
            onClick={() => exportCsv('expenses').catch((e) => setError(e.response?.data?.error || 'Export failed'))}
            title="Download expenses as CSV"
          >
            Export CSV
          </button>
          <div className="bg-white rounded-lg shadow px-4 py-2">
            <span className="text-sm text-slate-500">Total: </span>
            <span className="font-bold text-slate-800">Rs {total.toFixed(2)}</span>
          </div>
        </div>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 max-w-md space-y-2">
        <h2 className="font-semibold text-slate-700">Record Expense</h2>
        <select
          className="w-full border rounded px-2 py-1"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          required
        >
          <option value="">Select category</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            className="flex-1 border rounded px-2 py-1"
            placeholder="Amount (Rs)"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
          <input
            type="date"
            className="flex-1 border rounded px-2 py-1"
            value={form.expense_date}
            onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
          />
        </div>
        <input
          className="w-full border rounded px-2 py-1"
          placeholder="Note (optional)"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
        <button className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700">
          Add Expense
        </button>
      </form>

      <div className="bg-white rounded-lg shadow table-wrap">
        <h2 className="font-semibold p-4 pb-2 text-slate-700">Expense History</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2">Category</th>
              <th className="p-2">Note</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2">By</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="p-2 text-xs">{e.expense_date}</td>
                <td className="p-2">{e.category}</td>
                <td className="p-2 text-slate-500">{e.note || '-'}</td>
                <td className="p-2 text-right font-semibold">Rs {Number(e.amount).toFixed(2)}</td>
                <td className="p-2 text-xs">{e.created_by_name || '-'}</td>
                <td className="p-2 text-right">
                  {canDelete && (
                    <button className="text-red-600 text-xs" onClick={() => handleDelete(e.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-400">
                  No expenses recorded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
