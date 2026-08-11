import { useEffect, useState } from 'react';
import { listStores } from '../api/stores';
import { listProducts } from '../api/products';
import { listTransfers, createTransfer } from '../api/transfers';

const EMPTY_LINE = { product_id: '', qty: 1 };

export default function Transfers() {
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [toStoreId, setToStoreId] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_LINE }]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const [s, p, t] = await Promise.all([listStores(), listProducts(), listTransfers()]);
      setStores(s.stores);
      setProducts(p.products);
      setTransfers(t.transfers);
    } catch (e) {
      setError(e.response?.data?.error || 'Load failed');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateLine = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const addLine = () => setItems((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!toStoreId) return setError('Select a destination store');
    const clean = items
      .filter((it) => it.product_id)
      .map((it) => ({ product_id: Number(it.product_id), qty: Number(it.qty) }));
    if (clean.length === 0) return setError('Add at least one product');
    try {
      await createTransfer({ to_store_id: Number(toStoreId), note, items: clean });
      setMsg('Stock transferred — source and destination stock updated');
      setItems([{ ...EMPTY_LINE }]);
      setNote('');
      setToStoreId('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">Stock Transfers</h1>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Create transfer */}
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm text-slate-600">Destination store</label>
              <select
                className="w-full border rounded px-2 py-1"
                value={toStoreId}
                onChange={(e) => setToStoreId(e.target.value)}
              >
                <option value="">Select store</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="flex flex-wrap gap-2 items-center">
                <select
                  className="flex-1 min-w-[150px] border rounded px-2 py-1 text-sm"
                  value={it.product_id}
                  onChange={(e) => updateLine(idx, 'product_id', e.target.value)}
                >
                  <option value="">Select product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (stock {p.stock_qty})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="w-20 border rounded px-1 py-1 text-sm"
                  placeholder="Qty"
                  min={1}
                  value={it.qty}
                  onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  className="text-red-500 text-sm"
                >
                  x
                </button>
              </div>
            ))}
            <button type="button" onClick={addLine} className="text-blue-600 text-sm">
              + Add line
            </button>
          </div>

          <button className="w-full bg-emerald-600 text-white py-2 rounded hover:bg-emerald-700">
            Transfer Stock
          </button>
        </form>

        {/* Transfer history */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold text-slate-700 mb-2">Transfer History</h2>
          <div className="overflow-x-auto max-h-[60vh] table-wrap">
            <table className="w-full text-sm">
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="border-b align-top">
                    <td className="py-1">
                      <div>
                        <span className="font-medium">{t.from_store_name}</span>
                        <span className="text-slate-400"> → </span>
                        <span className="font-medium">{t.to_store_name}</span>
                      </div>
                      {t.note && <div className="text-xs text-slate-500">{t.note}</div>}
                      <div className="text-xs text-slate-400">
                        {t.item_count} item(s) · {new Date(t.created_at).toLocaleString()} ·{' '}
                        {t.created_by_name || '-'}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {t.items.map((it) => (
                          <div key={it.id} className="text-xs text-slate-600">
                            {it.product_name} × {it.qty}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {transfers.length === 0 && (
                  <tr>
                    <td className="p-3 text-center text-slate-400">No transfers yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
