import { useEffect, useState } from 'react';
import { getCurrentStore, updateCurrentStore } from '../api/stores';
import { useDispatch } from 'react-redux';
import { setCurrentStoreInfo } from '../store/slices/storeSlice';

export default function Settings() {
  const dispatch = useDispatch();
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    gstin: '',
    receipt_footer: '',
  });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getCurrentStore()
      .then(({ store }) => {
        setForm({
          name: store.name || '',
          address: store.address || '',
          phone: store.phone || '',
          gstin: store.gstin || '',
          receipt_footer: store.receipt_footer || '',
        });
        dispatch(setCurrentStoreInfo(store));
      })
      .catch((e) => setError(e.response?.data?.error || 'Failed to load settings'));
  }, [dispatch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const { store } = await updateCurrentStore(form);
      setMsg('Settings saved');
      dispatch(setCurrentStoreInfo(store));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  const field =
    'w-full border rounded px-2 py-1';
  const label = 'block text-sm text-slate-600 mb-1';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">Shop Settings</h1>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 max-w-md space-y-3">
        <p className="text-sm text-slate-500">
          These details are printed on your receipts (POS + invoice print).
        </p>
        <div>
          <label className={label}>Store / Shop Name *</label>
          <input
            className={field}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label className={label}>Address</label>
          <input
            className={field}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>Phone</label>
          <input
            className={field}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>GSTIN</label>
          <input
            className={field}
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>Receipt Footer (thank-you message)</label>
          <textarea
            className={`${field} resize-y`}
            rows={2}
            value={form.receipt_footer}
            onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })}
          />
        </div>
        <button className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700">
          Save Settings
        </button>
      </form>
    </div>
  );
}
