import { useEffect, useState } from 'react';
import { listStores, createStore, updateStore } from '../api/stores';
import { useDispatch } from 'react-redux';
import { setStores } from '../store/slices/storeSlice';

const EMPTY = { name: '', address: '', phone: '', gstin: '', receipt_footer: '' };

export default function Stores() {
  const dispatch = useDispatch();
  const [stores, setStoresList] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const data = await listStores();
      setStoresList(data.stores);
      dispatch(setStores(data.stores));
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
      if (editing) {
        await updateStore(editing.id, form);
        setMsg('Store updated');
      } else {
        await createStore(form);
        setMsg('Store created');
      }
      setForm(EMPTY);
      setEditing(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  const startEdit = (s) => {
    setEditing(s);
    setForm({
      name: s.name || '',
      address: s.address || '',
      phone: s.phone || '',
      gstin: s.gstin || '',
      receipt_footer: s.receipt_footer || '',
    });
    setMsg('');
    setError('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">Stores</h1>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      <div className="bg-white rounded-lg shadow p-4 max-w-md">
        <h2 className="font-semibold mb-2 text-slate-700">
          {editing ? `Edit: ${editing.name}` : 'Add Store'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="Store Name *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="GSTIN"
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
          />
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="Receipt footer message"
            value={form.receipt_footer}
            onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })}
          />
          <div className="flex gap-2">
            <button className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700">
              {editing ? 'Save Changes' : 'Create Store'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={cancelEdit}
                className="flex-1 bg-slate-400 text-white py-2 rounded hover:bg-slate-500"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Address</th>
              <th className="p-2">Phone</th>
              <th className="p-2">GSTIN</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2 font-medium">{s.name}</td>
                <td className="p-2">{s.address || '-'}</td>
                <td className="p-2">{s.phone || '-'}</td>
                <td className="p-2">{s.gstin || '-'}</td>
                <td className="p-2 text-right">
                  <button className="text-blue-600" onClick={() => startEdit(s)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {stores.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-400">
                  No stores yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
