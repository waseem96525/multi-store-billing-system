import { useEffect, useState } from 'react';
import { listSuppliers, createSupplier } from '../api/suppliers';
import { listProducts } from '../api/products';
import { listPurchases, createPurchase, getPurchase } from '../api/purchases';

const EMPTY_LINE = { product_id: '', qty: 1, cost_price: 0 };

export default function Purchases() {
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_LINE }]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [showSupplierModal, setShowSupplierModal] = useState(false);

  const load = async () => {
    const [s, p, pu] = await Promise.all([listSuppliers(), listProducts(), listPurchases()]);
    setSuppliers(s.suppliers);
    setProducts(p.products);
    setPurchases(pu.purchases);
  };

  useEffect(() => {
    load().catch((e) => setError(e.response?.data?.error || 'Load failed'));
  }, []);

  const total = items.reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.cost_price) || 0),
    0
  );

  const updateLine = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const addLine = () => setItems((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleLoadRestock = async () => {
    setError('');
    try {
      const data = await listProducts({ low_stock: '1' });
      const low = data.products || [];
      if (low.length === 0) {
        setMsg('No products are below their reorder level');
        return;
      }
      const lines = low.map((p) => ({
        product_id: String(p.id),
        qty: Math.max(1, Math.ceil(Number(p.reorder_level) * 2 - Number(p.stock_qty))),
        cost_price: Number(p.cost_price) || 0,
      }));
      setItems(lines);
      setMsg(`Loaded ${lines.length} low-stock product(s) — adjust quantities and record the purchase`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load low stock items');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!supplierId) return setError('Select a supplier');
    const clean = items
      .filter((it) => it.product_id)
      .map((it) => ({
        product_id: Number(it.product_id),
        qty: Number(it.qty),
        cost_price: Number(it.cost_price),
      }));
    if (clean.length === 0) return setError('Add at least one product');
    try {
      await createPurchase({ supplier_id: Number(supplierId), invoice_ref: invoiceRef, items: clean });
      setMsg('Purchase recorded — stock updated');
      setItems([{ ...EMPTY_LINE }]);
      setInvoiceRef('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    }
  };

  const [supForm, setSupForm] = useState({ name: '', phone: '', email: '', address: '' });
  const handleCreateSupplier = async (e) => {
    e.preventDefault();
    try {
      await createSupplier(supForm);
      setShowSupplierModal(false);
      setSupForm({ name: '', phone: '', email: '', address: '' });
      const s = await listSuppliers();
      setSuppliers(s.suppliers);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add supplier');
    }
  };

  const [detail, setDetail] = useState(null);
  const openDetail = async (id) => {
    const d = await getPurchase(id);
    setDetail(d);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">Purchases / Stock In</h1>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Create purchase */}
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm text-slate-600">Supplier</label>
              <select
                className="w-full border rounded px-2 py-1"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowSupplierModal(true)}
              className="text-blue-600 text-sm whitespace-nowrap"
            >
              + New
            </button>
          </div>
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="Invoice / Bill Ref (optional)"
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
          />

          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Items</span>
            <button
              type="button"
              onClick={handleLoadRestock}
              className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded hover:bg-amber-200"
              title="Fill the list with products that are below their reorder level"
            >
              Load low stock
            </button>
          </div>

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
                  className="w-16 border rounded px-1 py-1 text-sm"
                  placeholder="Qty"
                  value={it.qty}
                  onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                />
                <input
                  type="number"
                  className="w-20 border rounded px-1 py-1 text-sm"
                  placeholder="Cost"
                  value={it.cost_price}
                  onChange={(e) => updateLine(idx, 'cost_price', e.target.value)}
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

          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>₹{total.toFixed(2)}</span>
          </div>
          <button className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700">
            Record Purchase
          </button>
        </form>

        {/* Recent purchases */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold text-slate-700 mb-2">Recent Purchases</h2>
          <div className="overflow-x-auto max-h-[60vh] table-wrap">
            <table className="w-full text-sm">
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-b cursor-pointer hover:bg-slate-50" onClick={() => openDetail(p.id)}>
                    <td className="py-1">#{p.id} · {p.supplier_name || '-'}</td>
                    <td className="py-1 text-right">₹{p.total_amount.toFixed(2)}</td>
                    <td className="py-1 text-right text-slate-400 text-xs">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {purchases.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-3 text-center text-slate-400">
                      No purchases yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New supplier modal */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <form onSubmit={handleCreateSupplier} className="bg-white p-5 rounded-lg w-[min(92vw,20rem)] space-y-2">
            <h2 className="font-bold">New Supplier</h2>
            <input className="w-full border rounded px-2 py-1" placeholder="Name *" required
              value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} />
            <input className="w-full border rounded px-2 py-1" placeholder="Phone" value={supForm.phone}
              onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} />
            <input className="w-full border rounded px-2 py-1" placeholder="Email" value={supForm.email}
              onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} />
            <input className="w-full border rounded px-2 py-1" placeholder="Address" value={supForm.address}
              onChange={(e) => setSupForm({ ...supForm, address: e.target.value })} />
            <div className="flex gap-2">
              <button className="flex-1 bg-green-600 text-white py-1 rounded">Save</button>
              <button type="button" className="flex-1 border py-1 rounded" onClick={() => setShowSupplierModal(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Purchase detail modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded-lg w-[min(92vw,24rem)] max-h-[90vh] overflow-auto">
            <h2 className="font-bold mb-2">Purchase #{detail.purchase.id}</h2>
            <div className="text-sm text-slate-600 mb-2">
              Supplier: {detail.purchase.supplier_name} <br />
              Ref: {detail.purchase.invoice_ref || '-'} <br />
              Total: ₹{detail.purchase.total_amount.toFixed(2)}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="py-1">{it.product_name}</td>
                    <td className="py-1 text-right">{it.qty} × ₹{it.cost_price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="mt-3 w-full border py-1 rounded" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
