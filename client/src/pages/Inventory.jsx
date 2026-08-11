import { useEffect, useState } from 'react';
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

const EMPTY = {
  name: '',
  sku: '',
  barcode: '',
  category_id: '',
  unit: 'pcs',
  cost_price: 0,
  selling_price: 0,
  tax_percent: 0,
  stock_qty: 0,
  reorder_level: 0,
};

export default function Inventory() {
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

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
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
      tax_percent: p.tax_percent,
      stock_qty: p.stock_qty,
      reorder_level: p.reorder_level,
    });
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
        tax_percent: Number(form.tax_percent),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Inventory</h1>
        <div className="flex gap-2">
          <button
            className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200"
            onClick={() => setShowCategories(true)}
          >
            Categories
          </button>
          <button
            className="bg-slate-800 text-white px-3 py-2 rounded hover:bg-slate-700"
            onClick={openAdd}
          >
            + Add Product
          </button>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

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
              <th className="p-2">SKU</th>
              <th className="p-2">Category</th>
              <th className="p-2 text-right">Cost</th>
              <th className="p-2 text-right">Price</th>
              <th className="p-2 text-right">Tax%</th>
              <th className="p-2 text-right">Stock</th>
              <th className="p-2 text-right">Reorder</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2 font-medium">{p.name}</td>
                <td className="p-2 text-slate-500">{p.sku || '-'}</td>
                <td className="p-2">{p.category_name || '-'}</td>
                <td className="p-2 text-right">{p.cost_price}</td>
                <td className="p-2 text-right">{p.selling_price}</td>
                <td className="p-2 text-right">{p.tax_percent}</td>
                <td className={`p-2 text-right ${p.stock_qty <= p.reorder_level ? 'text-red-600 font-semibold' : ''}`}>
                  {p.stock_qty}
                </td>
                <td className="p-2 text-right">{p.reorder_level}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  <button className="text-blue-600 mr-2" onClick={() => openEdit(p)}>
                    Edit
                  </button>
                  <button className="text-red-600" onClick={() => handleDelete(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-slate-400">
                  No products found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <form
            onSubmit={handleSubmit}
            className="bg-white p-5 rounded-lg w-[min(92vw,24rem)] max-h-[90vh] overflow-auto space-y-2"
          >
            <h2 className="font-bold text-lg mb-2">
              {editing ? 'Edit Product' : 'Add Product'}
            </h2>
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
                Tax %
                <input
                  type="number"
                  className="w-full border rounded px-2 py-1"
                  value={form.tax_percent}
                  onChange={(e) => setForm({ ...form, tax_percent: e.target.value })}
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
                  className="flex items-center justify-between border rounded px-3 py-2"
                >
                  <span>{c.name}</span>
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
    </div>
  );
}
