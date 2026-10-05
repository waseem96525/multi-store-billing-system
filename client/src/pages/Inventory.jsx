import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
} from '../api/products';
import { printLabels } from '../utils/print';
import {
  isConnected as printerConnected,
  getConfig as getPrinterConfig,
  printLabels as printSerialLabels,
} from '../utils/serialPrinter';
import { exportCsv } from '../api/export';
import { listCombos, createCombo, updateCombo, deleteCombo } from '../api/combos';
import { importProducts } from '../api/import';
import { parseCsv, csvToObjects } from '../utils/csv';
import useLiveCatalog from '../realtime/useLiveCatalog';
import { useSelector } from 'react-redux';
import { can, PERM } from '../utils/permissions';

const EMPTY = {
  name: '',
  sku: '',
  barcode: '',
  category_id: '',
  unit: 'pcs',
  cost_price: 0,
  selling_price: 0,
  mrp: 0,
  tax_percent: 0,
  discount_pct: 0,
  stock_qty: 0,
  reorder_level: 0,
  description: '',
  brand: '',
  hsn_code: '',
  expiry_date: '',
  location: '',
};

export default function Inventory() {
  const user = useSelector((s) => s.auth.user);
  const canEdit = can(user, PERM.INVENTORY_EDIT);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [showCategories, setShowCategories] = useState(false);
  const [catName, setCatName] = useState('');
  const [catError, setCatError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState('add');
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [showCombos, setShowCombos] = useState(false);
  const [combos, setCombos] = useState([]);
  const [comboForm, setComboForm] = useState(null);
  const [comboItemPick, setComboItemPick] = useState('');
  const [comboItemQty, setComboItemQty] = useState('1');
  const [comboBusy, setComboBusy] = useState(false);
  const [comboError, setComboError] = useState('');

  const [printerAuto] = useState(() => getPrinterConfig().autoUse);
  const [printMsg, setPrintMsg] = useState('');

  const formRef = useRef(null);

  const panelRef = useRef(null);
  const dragOrigin = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const startDrag = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const t = e.target;
    if (t.closest && t.closest('input, select, textarea, button, a, [contenteditable]')) return;
    dragOrigin.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    setDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => {
      const d = dragOrigin.current;
      if (!d) return;
      setPos({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging]);

  useEffect(() => {
    if (!showForm) return;
    const prevOverflow = document.body.style.overflow;
    const prevOverflowX = document.body.style.overflowX;
    document.body.style.overflow = 'hidden';
    document.body.style.overflowX = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overflowX = prevOverflowX;
    };
  }, [showForm]);

  const load = async () => {
    try {
      const data = await listProducts({ q: q || undefined, low_stock: lowStock ? '1' : undefined });
      setProducts(data.products);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load');
    }
  };

  useEffect(() => {
    load();
    listCategories().then((d) => setCategories(d.categories)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q, lowStock]);

  // Live sync: reload when products/stock change on any device (debounced so
  // bursts of updates from another terminal are batched into one reload).
  const live = useLiveCatalog();
  useEffect(() => {
    if (!live.ready) return;
    const t = setTimeout(load, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.version]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setPos({ x: 0, y: 0 });
    setShowForm(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({
      name: p.name,
      sku: p.sku || '',
      barcode: p.barcode || '',
      category_id: p.category_id || '',
      unit: p.unit || 'pcs',
      cost_price: p.cost_price,
      selling_price: p.selling_price,
      mrp: p.mrp || 0,
      tax_percent: p.tax_percent,
      discount_pct: p.discount_pct || 0,
      stock_qty: p.stock_qty,
      reorder_level: p.reorder_level,
      description: p.description || '',
      brand: p.brand || '',
      hsn_code: p.hsn_code || '',
      expiry_date: p.expiry_date || '',
      location: p.location || '',
    });
    setPos({ x: 0, y: 0 });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        ...form,
        category_id: form.category_id ? Number(form.category_id) : null,
        cost_price: Number(form.cost_price),
        selling_price: Number(form.selling_price),
        mrp: Number(form.mrp),
        tax_percent: Number(form.tax_percent),
        discount_pct: Number(form.discount_pct),
        stock_qty: Number(form.stock_qty),
        reorder_level: Number(form.reorder_level),
      };
      if (editing) await updateProduct(editing.id, payload);
      else await createProduct(payload);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  };

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete ${p.name}?`)) return;
    try {
      await deleteProduct(p.id);
      load();
    } catch (e) {
      setError(e.response?.data?.error || 'Delete failed');
    }
  };

  const handleNewCategory = async () => {
    const name = window.prompt('New category name');
    if (!name) return;
    try {
      const res = await createCategory(name);
      setCategories((c) => [...c, res.category]);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed');
    }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    setCatError('');
    const name = catName.trim();
    if (!name) return;
    try {
      const res = await createCategory(name);
      setCategories((c) => [...c, res.category]);
      setCatName('');
    } catch (err) {
      setCatError(err.response?.data?.error || 'Failed to add category');
    }
  };

  const handleRenameCategory = async (cat) => {
    const name = window.prompt('Rename category', cat.name);
    if (!name || name.trim() === cat.name) return;
    try {
      await renameCategory(cat.id, name.trim());
      setCategories((c) => c.map((x) => (x.id === cat.id ? { ...x, name: name.trim() } : x)));
    } catch (e) {
      setCatError(e.response?.data?.error || 'Rename failed');
    }
  };

  const handleDeleteCategory = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}"? Products in it will become uncategorized.`))
      return;
    try {
      await deleteCategory(cat.id);
      setCategories((c) => c.filter((x) => x.id !== cat.id));
      load();
    } catch (e) {
      setCatError(e.response?.data?.error || 'Delete failed');
    }
  };

  // ---- Combos (bundle pricing) ----
  const loadCombos = async () => {
    try {
      const d = await listCombos();
      setCombos(d.combos || []);
    } catch (e) {
      setComboError(e.response?.data?.error || 'Failed to load combos');
    }
  };

  const openCombos = () => {
    setComboError('');
    setShowCombos(true);
    loadCombos();
  };

  const startNewCombo = () => {
    setComboForm({ name: '', price: '', active: true, items: [] });
    setComboItemPick('');
    setComboItemQty('1');
    setComboError('');
  };

  const openComboEdit = (c) => {
    setComboForm({
      id: c.id,
      name: c.name,
      price: String(c.price),
      active: c.active !== false,
      items: (c.items || []).map((i) => ({ product_id: i.product_id, qty: i.qty })),
    });
    setComboItemPick('');
    setComboItemQty('1');
    setComboError('');
  };

  const addComboItem = () => {
    const pid = Number(comboItemPick);
    const qty = Math.max(1, Math.floor(Number(comboItemQty) || 1));
    if (!pid) return;
    setComboForm((f) => {
      if (!f) return f;
      const items = [...f.items];
      const idx = items.findIndex((i) => i.product_id === pid);
      if (idx >= 0) items[idx] = { ...items[idx], qty: items[idx].qty + qty };
      else items.push({ product_id: pid, qty });
      return { ...f, items };
    });
    setComboItemPick('');
    setComboItemQty('1');
  };

  const removeComboItem = (idx) => {
    setComboForm((f) => f && { ...f, items: f.items.filter((_, i) => i !== idx) });
  };

  const saveCombo = async (e) => {
    e.preventDefault();
    if (!comboForm) return;
    if (!comboForm.name.trim()) {
      setComboError('Combo name required');
      return;
    }
    if (!comboForm.items.length) {
      setComboError('Add at least one item to the combo');
      return;
    }
    setComboBusy(true);
    setComboError('');
    try {
      const payload = {
        name: comboForm.name.trim(),
        price: Number(comboForm.price),
        active: comboForm.active !== false,
        items: comboForm.items,
      };
      if (comboForm.id) await updateCombo(comboForm.id, payload);
      else await createCombo(payload);
      setComboForm(null);
      await loadCombos();
    } catch (err) {
      setComboError(err.response?.data?.error || 'Failed to save combo');
    } finally {
      setComboBusy(false);
    }
  };

  const handleDeleteCombo = async (c) => {
    if (!window.confirm(`Delete combo "${c.name}"?`)) return;
    try {
      await deleteCombo(c.id);
      await loadCombos();
    } catch (err) {
      setComboError(err.response?.data?.error || 'Failed to delete combo');
    }
  };

  const toggleComboActive = async (c) => {
    try {
      await updateCombo(c.id, {
        name: c.name,
        price: c.price,
        active: c.active === false,
        items: (c.items || []).map((i) => ({ product_id: i.product_id, qty: i.qty })),
      });
      await loadCombos();
    } catch (err) {
      setComboError(err.response?.data?.error || 'Failed to update combo');
    }
  };

  const toLabelItems = (list) =>
    list.map((p) => ({
      name: p.name,
      price: 'Rs ' + Number(p.selling_price || 0).toFixed(2),
      code: p.barcode || p.sku || String(p.id),
      copies: 1,
    }));

  const handlePrintSerial = async (list) => {
    if (!printerConnected()) {
      setPrintMsg('USB printer not connected (set it up in Settings)');
      return;
    }
    setPrintMsg('');
    try {
      const items = toLabelItems(list);
      if (!items.length) return;
      await printSerialLabels(items);
      setPrintMsg(`Sent ${list.length} label(s) to USB printer`);
    } catch (e) {
      setPrintMsg(e.message || 'Print failed');
    }
  };

  // Quick single-label print from a product row. Bulk/format printing lives on
  // the dedicated /barcode-labels page.
  const handlePrintOne = (p) => {
    if (printerAuto && printerConnected()) handlePrintSerial([p]);
    else printLabels(toLabelItems([p]));
  };

  const openImport = () => {
    setShowImport(true);
    setImportText('');
    setImportMode('add');
    setImportResult(null);
    setImportError('');
  };

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    setImportError('');
    setImportResult(null);
    const parsed = parseCsv(importText);
    if (parsed.length < 2) {
      setImportError('CSV needs a header row and at least one data row');
      return;
    }
    const rows = csvToObjects(parsed);
    setImporting(true);
    try {
      const res = await importProducts(rows, importMode);
      setImportResult(res);
      load();
    } catch (err) {
      setImportError(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-800">Inventory</h1>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button
              className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200"
              onClick={() => setShowCategories(true)}
            >
              Categories
            </button>
          )}
          {canEdit && (
            <button
              className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200"
              onClick={openCombos}
              title="Bundle pricing — groups of products sold at one price"
            >
              Combos
            </button>
          )}
          <Link
            to="/barcode-labels"
            className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200"
            title="Open the dedicated barcode label printing page"
          >
            Print Labels
          </Link>
          <button
            className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200"
            onClick={() => exportCsv('products').catch((e) => setError(e.response?.data?.error || 'Export failed'))}
            title="Download inventory as CSV"
          >
            Export CSV
          </button>
          {canEdit && (
            <>
              <button
                className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200"
                onClick={openImport}
                title="Bulk load products and stock from a CSV file"
              >
                Import CSV
              </button>
              <button
                className="bg-slate-800 text-white px-3 py-2 rounded hover:bg-slate-700"
                onClick={openAdd}
              >
                + Add Product
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}
      {printMsg && (
        <div className={printMsg.includes('Sent') ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
          {printMsg}
        </div>
      )}

      <div className="flex gap-3 items-center">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Search products..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(e) => setLowStock(e.target.checked)}
          />
          Low stock only
        </label>
      </div>

      <div className="bg-white rounded-lg shadow table-wrap">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="p-2">Name</th>
              <th className="p-2">Brand</th>
              <th className="p-2">SKU</th>
              <th className="p-2">Category</th>
              <th className="p-2 text-right">Cost</th>
              <th className="p-2 text-right">Price</th>
              <th className="p-2 text-right">MRP</th>
              <th className="p-2 text-right">Tax%</th>
              <th className="p-2 text-right">Disc%</th>
              <th className="p-2 text-right">Stock</th>
              <th className="p-2 text-right">Reorder</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2 font-medium">{p.name}</td>
                <td className="p-2 text-slate-500">{p.brand || '-'}</td>
                <td className="p-2 text-slate-500">{p.sku || '-'}</td>
                <td className="p-2">{p.category_name || '-'}</td>
                <td className="p-2 text-right">{p.cost_price}</td>
                <td className="p-2 text-right">{p.selling_price}</td>
                <td className="p-2 text-right">{p.mrp || '-'}</td>
                <td className="p-2 text-right">{p.tax_percent}</td>
                <td className={`p-2 text-right ${p.discount_pct > 0 ? 'text-emerald-600 font-semibold' : ''}`}>
                  {p.discount_pct > 0 ? p.discount_pct : '-'}
                </td>
                <td className={`p-2 text-right ${p.stock_qty <= p.reorder_level ? 'text-red-600 font-semibold' : ''}`}>
                  {p.stock_qty}
                </td>
                <td className="p-2 text-right">{p.reorder_level}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <button className="text-blue-600 mr-2" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                      <button className="text-red-600 mr-2" onClick={() => handleDelete(p)}>
                        Delete
                      </button>
                    </>
                  )}
                  <button
                    className="text-slate-500 mr-2"
                    title="Print barcode label"
                    onClick={() => handlePrintOne(p)}
                  >
                    Print
                  </button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={12} className="p-4 text-center text-slate-400">
                  No products found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div
            ref={panelRef}
            onPointerDown={startDrag}
            style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
            className="relative cursor-move w-[min(92vw,24rem)]"
          >
            <form
              ref={formRef}
              onSubmit={handleSubmit}
              className="bg-white p-5 rounded-lg max-h-[90vh] overflow-y-auto overflow-x-hidden space-y-2"
            >
            <div
              className="flex items-center justify-between mb-2 cursor-move select-none touch-none"
            >
              <h2 className="font-bold text-lg">
                {editing ? 'Edit Product' : 'Add Product'}
              </h2>
              <span className="text-xs text-slate-400">⠿ drag</span>
            </div>
            <input
              className="w-full border rounded px-2 py-1"
              placeholder="Name *"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded px-2 py-1"
                placeholder="SKU"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
              <input
                className="flex-1 border rounded px-2 py-1"
                placeholder="Barcode"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <select
                className="flex-1 border rounded px-2 py-1"
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={handleNewCategory} className="text-xs text-blue-600">
                + Cat
              </button>
              <input
                className="w-20 border rounded px-2 py-1"
                placeholder="Unit"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded px-2 py-1"
                placeholder="Brand"
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
              />
              <input
                className="flex-1 border rounded px-2 py-1"
                placeholder="HSN Code"
                value={form.hsn_code}
                onChange={(e) => setForm({ ...form, hsn_code: e.target.value })}
              />
            </div>
            <input
              className="w-full border rounded px-2 py-1"
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">
                Cost Price
                <input
                  type="number"
                  className="w-full border rounded px-2 py-1"
                  value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Selling Price
                <input
                  type="number"
                  className="w-full border rounded px-2 py-1"
                  value={form.selling_price}
                  onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                MRP
                <input
                  type="number"
                  className="w-full border rounded px-2 py-1"
                  value={form.mrp}
                  onChange={(e) => setForm({ ...form, mrp: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Expiry Date
                <input
                  type="date"
                  className="w-full border rounded px-2 py-1"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Shelf / Location
                <input
                  className="w-full border rounded px-2 py-1"
                  placeholder="e.g. Aisle 2, Rack 3"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Tax %
                <input
                  type="number"
                  className="w-full border rounded px-2 py-1"
                  value={form.tax_percent}
                  onChange={(e) => setForm({ ...form, tax_percent: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500 min-w-0">
                Item Discount % (auto-applied in POS)
                <div className="flex items-center gap-2 mt-1 flex-wrap min-w-0">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Number(form.discount_pct) || 0}
                    onChange={(e) => setForm({ ...form, discount_pct: Number(e.target.value) })}
                    className="flex-1 min-w-0 accent-emerald-600"
                  />
                  <span className="w-12 text-right font-semibold text-emerald-700">
                    {Number(form.discount_pct) || 0}%
                  </span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full border rounded px-2 py-1 mt-1"
                  value={form.discount_pct}
                  onChange={(e) => setForm({ ...form, discount_pct: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Stock Qty
                <input
                  type="number"
                  className="w-full border rounded px-2 py-1"
                  value={form.stock_qty}
                  onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Reorder Level
                <input
                  type="number"
                  className="w-full border rounded px-2 py-1"
                  value={form.reorder_level}
                  onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                />
              </label>
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700"
              >
                Save
              </button>
              <button
                type="button"
                className="flex-1 border py-2 rounded"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
          </div>
        </div>
      )}
      {showCategories && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded-lg w-[min(92vw,24rem)] max-h-[90vh] overflow-auto space-y-3">
            <h2 className="font-bold text-lg">Categories</h2>
            <form onSubmit={handleAddCategory} className="flex gap-2">
              <input
                className="flex-1 border rounded px-2 py-1"
                placeholder="New category name"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
              />
              <button
                type="submit"
                className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
              >
                Add
              </button>
            </form>
            {catError && <div className="text-red-600 text-sm">{catError}</div>}
            <div className="space-y-1 max-h-64 overflow-auto">
              {categories.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 border rounded px-3 py-2"
                >
                  <span className="truncate min-w-0">{c.name}</span>
                  <div className="space-x-2">
                    <button
                      className="text-blue-600 text-sm"
                      onClick={() => handleRenameCategory(c)}
                    >
                      Rename
                    </button>
                    <button
                      className="text-red-600 text-sm"
                      onClick={() => handleDeleteCategory(c)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {categories.length === 0 && (
                <div className="text-center text-slate-400 text-sm py-4">
                  No categories yet
                </div>
              )}
            </div>
            <button
              className="w-full border py-2 rounded"
              onClick={() => setShowCategories(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showCombos && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded-lg w-[min(92vw,30rem)] max-h-[90vh] overflow-auto space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Combos (Bundle Pricing)</h2>
              {canEdit && !comboForm && (
                <button
                  className="bg-slate-800 text-white px-3 py-1.5 rounded text-sm hover:bg-slate-700"
                  onClick={startNewCombo}
                >
                  + New Combo
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              A combo is a fixed group of products sold at one price. The POS
              shows a “Combos” shelf — tapping one adds the whole bundle at the
              combo price (the difference is applied as item discounts, so tax
              and stock stay correct).
            </p>
            {comboError && <div className="text-red-600 text-sm">{comboError}</div>}

            {comboForm ? (
              <form onSubmit={saveCombo} className="space-y-3 border rounded p-3 bg-slate-50">
                <div className="text-sm font-semibold text-slate-700">
                  {comboForm.id ? 'Edit combo' : 'New combo'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Combo name</label>
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={comboForm.name}
                      onChange={(e) =>
                        setComboForm({ ...comboForm, name: e.target.value })
                      }
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Combo price (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-full border rounded px-2 py-1"
                      value={comboForm.price}
                      onChange={(e) =>
                        setComboForm({ ...comboForm, price: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-1">Items in combo</div>
                  {comboForm.items.length === 0 && (
                    <div className="text-xs text-slate-400 mb-1">No items yet — add below.</div>
                  )}
                  <div className="space-y-1">
                    {comboForm.items.map((it, idx) => {
                      const p = products.find((x) => x.id === it.product_id);
                      return (
                        <div
                          key={it.product_id}
                          className="flex items-center justify-between text-xs border rounded px-2 py-1 bg-white"
                        >
                          <span>
                            {it.qty}× {p ? p.name : `#${it.product_id}`}
                          </span>
                          <button
                            type="button"
                            className="text-red-600"
                            onClick={() => removeComboItem(idx)}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <select
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      value={comboItemPick}
                      onChange={(e) => setComboItemPick(e.target.value)}
                    >
                      <option value="">— pick product —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (₹{p.selling_price})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      className="w-16 border rounded px-2 py-1 text-sm text-center"
                      value={comboItemQty}
                      onChange={(e) => setComboItemQty(e.target.value)}
                    />
                    <button
                      type="button"
                      className="border px-3 py-1 rounded text-sm hover:bg-slate-50"
                      onClick={addComboItem}
                    >
                      Add
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={comboForm.active !== false}
                    onChange={(e) =>
                      setComboForm({ ...comboForm, active: e.target.checked })
                    }
                  />
                  Active (shown on the POS combo shelf)
                </label>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={comboBusy}
                    className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    {comboBusy ? 'Saving…' : 'Save Combo'}
                  </button>
                  <button
                    type="button"
                    className="flex-1 border py-2 rounded"
                    onClick={() => setComboForm(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-2 max-h-72 overflow-auto">
                {combos.map((c) => (
                  <div
                    key={c.id}
                    className="border rounded p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {c.name}{' '}
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            c.active !== false
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {c.active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                      <span className="text-slate-700 font-semibold">
                        ₹{Number(c.price).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {c.items
                        .map((i) => `${i.qty}× ${i.name}`)
                        .join(' · ')}
                    </div>
                    {canEdit && (
                      <div className="flex gap-3 text-xs">
                        <button className="text-blue-600" onClick={() => openComboEdit(c)}>
                          Edit
                        </button>
                        <button className="text-amber-600" onClick={() => toggleComboActive(c)}>
                          {c.active !== false ? 'Deactivate' : 'Activate'}
                        </button>
                        <button className="text-red-600" onClick={() => handleDeleteCombo(c)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {combos.length === 0 && (
                  <div className="text-center text-slate-400 text-sm py-4">
                    No combos yet
                  </div>
                )}
              </div>
            )}

            <button
              className="w-full border py-2 rounded"
              onClick={() => {
                setShowCombos(false);
                setComboForm(null);
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded-lg w-[min(92vw,32rem)] max-h-[90vh] overflow-auto space-y-3">
            <h2 className="font-bold text-lg">Bulk Import Products / Stock</h2>
            <p className="text-xs text-slate-500">
              Paste CSV or upload a file. Columns are matched by header name (e.g.{' '}
              <code>Name</code>, <code>SKU</code>, <code>Barcode</code>, <code>Category</code>,{' '}
              <code>Cost Price</code>, <code>Selling Price</code>, <code>MRP</code>,{' '}
              <code>Tax %</code>, <code>Stock</code>, <code>Reorder Level</code>). Existing
              products are matched by barcode, SKU or name; missing ones are created. Tip: use
              <button
                className="text-blue-600 underline ml-1"
                onClick={() =>
                  exportCsv('products').catch((e) =>
                    setImportError(e.response?.data?.error || 'Download failed')
                  )
                }
              >
                Export CSV
              </button>
              as a template.
            </p>

            <div className="flex items-center gap-3 text-sm text-slate-600">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'add'}
                  onChange={() => setImportMode('add')}
                />
                Add to existing stock
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'set'}
                  onChange={() => setImportMode('set')}
                />
                Set exact stock
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-slate-500">Or choose a CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm border rounded px-2 py-1.5"
                onChange={handleImportFile}
              />
            </label>

            <textarea
              className="w-full border rounded px-2 py-1 font-mono text-xs h-40"
              placeholder={'Name,SKU,Barcode,Category,Unit,Cost Price,Selling Price,Stock,Reorder Level\nRice 5kg,RICE5,8901234567,Grains,bag,1800,2100,50,10'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />

            {importError && <div className="text-red-600 text-sm">{importError}</div>}

            {importResult && (
              <div className="text-sm border rounded p-3 space-y-1">
                <div className="font-semibold text-slate-700">Import complete</div>
                <div className="text-green-600">
                  {importResult.summary.created} created, {importResult.summary.updated} updated
                </div>
                {importResult.summary.failed > 0 && (
                  <div className="text-red-600">{importResult.summary.failed} failed</div>
                )}
                {importResult.results.filter((r) => r.status === 'error').length > 0 && (
                  <div className="max-h-32 overflow-auto border-t pt-1 mt-1">
                    {importResult.results
                      .filter((r) => r.status === 'error')
                      .map((r, i) => (
                        <div key={i} className="text-red-600 text-xs">
                          Row {r.row}: {r.name || '?'} - {r.error}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
                onClick={handleImport}
                disabled={importing || !importText.trim()}
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
              <button
                className="flex-1 border py-2 rounded"
                onClick={() => setShowImport(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
