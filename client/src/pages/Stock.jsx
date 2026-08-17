import { useEffect, useState } from 'react';
import { listProducts } from '../api/products';
import { adjustStock, listAdjustments } from '../api/stock';
import useLiveCatalog from '../realtime/useLiveCatalog';

export default function Stock() {
  const [products, setProducts] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [form, setForm] = useState({ product_id: '', change_qty: 0, reason: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [p, a] = await Promise.all([listProducts(), listAdjustments()]);
    setProducts(p.products);
    setAdjustments(a.adjustments);
  };

  useEffect(() => {
    load().catch((e) => setError(e.response?.data?.error || 'Load failed'));
  }, []);

  // Live sync: refresh the product/stock list when other devices change them.
  const live = useLiveCatalog();
  useEffect(() => {
    if (!live.ready) return;
    const t = setTimeout(load, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.version]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!form.product_id) return setError('Select a product');
    try {
      await adjustStock({
        product_id: Number(form.product_id),
        change_qty: Number(form.change_qty),
        reason: form.reason,
      });
      setMsg('Stock adjusted');
      setForm({ product_id: '', change_qty: 0, reason: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">Stock Adjustments</h1>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 max-w-md space-y-2">
        <h2 className="font-semibold text-slate-700">Adjust Stock</h2>
        <select
          className="w-full border rounded px-2 py-1"
          value={form.product_id}
          onChange={(e) => setForm({ ...form, product_id: e.target.value })}
        >
          <option value="">Select product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (stock {p.stock_qty})
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <label className="flex-1 text-sm text-slate-500">
            Change (+/-)
            <input
              type="number"
              className="w-full border rounded px-2 py-1"
              value={form.change_qty}
              onChange={(e) => setForm({ ...form, change_qty: e.target.value })}
            />
          </label>
        </div>
        <input
          className="w-full border rounded px-2 py-1"
          placeholder="Reason (damage, correction, return...)"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700">
          Apply Adjustment
        </button>
      </form>

      <div className="bg-white rounded-lg shadow table-wrap">
        <h2 className="font-semibold p-4 pb-2 text-slate-700">Adjustment History</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="p-2">Product</th>
              <th className="p-2 text-right">Change</th>
              <th className="p-2">Reason</th>
              <th className="p-2">By</th>
              <th className="p-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {adjustments.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-2">{a.product_name}</td>
                <td className={`p-2 text-right font-semibold ${a.change_qty > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {a.change_qty > 0 ? '+' : ''}
                  {a.change_qty}
                </td>
                <td className="p-2">{a.reason || '-'}</td>
                <td className="p-2">{a.adjusted_by_name || '-'}</td>
                <td className="p-2 text-xs text-slate-400">
                  {new Date(a.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {adjustments.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-400">
                  No adjustments recorded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
