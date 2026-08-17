import { useEffect, useState } from 'react';
import { getCurrentStore, updateCurrentStore } from '../api/stores';
import { useDispatch } from 'react-redux';
import { setCurrentStoreInfo } from '../store/slices/storeSlice';
import { downloadBackup } from '../api/backup';
import { fileToDataUrl } from '../utils/image';
import {
  isSupported,
  subscribe,
  connect,
  disconnect,
  getConfig,
  setConfig,
  printTestLabel,
} from '../utils/serialPrinter';

export default function Settings() {
  const dispatch = useDispatch();
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    gstin: '',
    receipt_footer: '',
    background: '',
  });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [bgPreview, setBgPreview] = useState('');
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState('');

  // Barcode printer (USB, Web Serial)
  const supported = isSupported();
  const [printer, setPrinter] = useState({ supported, connected: false, portName: 'Not connected' });
  const [pcfg, setPcfg] = useState(getConfig());
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerMsg, setPrinterMsg] = useState('');

  useEffect(() => subscribe(setPrinter), []);

  const savePrinterCfg = (patch) => {
    const next = setConfig(patch);
    setPcfg(next);
  };

  const handleConnect = async () => {
    setPrinterMsg('');
    try {
      if (printer.connected) {
        await disconnect();
        setPrinterMsg('Printer disconnected');
      } else {
        await connect();
        setPrinterMsg('Printer connected');
      }
    } catch (e) {
      setPrinterMsg(e.message || 'Could not connect');
    }
  };

  const handleTest = async () => {
    setPrinterBusy(true);
    setPrinterMsg('');
    try {
      await printTestLabel();
      setPrinterMsg('Test label sent');
    } catch (e) {
      setPrinterMsg(e.message || 'Print failed');
    } finally {
      setPrinterBusy(false);
    }
  };

  useEffect(() => {
    getCurrentStore()
      .then(({ store }) => {
        setForm({
          name: store.name || '',
          address: store.address || '',
          phone: store.phone || '',
          gstin: store.gstin || '',
          receipt_footer: store.receipt_footer || '',
          background: store.background || '',
        });
        setBgPreview(store.background || '');
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
      setBgPreview(store.background || '');
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

      <div className="bg-white rounded-lg shadow p-4 max-w-md">
        <h2 className="font-semibold text-slate-700 mb-1">Database Backup</h2>
        <p className="text-sm text-slate-500 mb-3">
          Download a full snapshot of your database (products, sales, purchases, staff and settings).
          Keep it safe — it can be restored later if anything goes wrong.
        </p>
        <button
          onClick={async () => {
            setError('');
            setMsg('');
            try {
              await downloadBackup();
              setMsg('Backup downloaded');
            } catch (e) {
              setError(e.response?.data?.error || 'Backup failed');
            }
          }}
          className="w-full bg-slate-800 text-white py-2 rounded hover:bg-slate-700"
        >
          Download Backup (.db)
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4 max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">Barcode / Label Printer (USB)</h2>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              printer.connected ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {printer.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        {!supported && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            Web Serial is not supported here. Use Chrome or Edge over HTTPS or localhost.
          </div>
        )}

        <p className="text-sm text-slate-500">
          Connect a USB thermal/label printer (Zebra, TSC, Godex, generic ESC/POS) and print
          product barcode labels directly from Inventory. The device stays paired for next time.
        </p>

        <div className="text-sm text-slate-600">
          Status: <span className="font-medium">{printer.portName}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Baud rate</label>
            <select
              className="w-full border rounded px-2 py-1"
              value={pcfg.baud}
              onChange={(e) => savePrinterCfg({ baud: Number(e.target.value) })}
            >
              {[9600, 19200, 38400, 57600, 115200].map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Label width (dots)</label>
            <input
              type="number"
              min={120}
              max={832}
              step={8}
              className="w-full border rounded px-2 py-1"
              value={pcfg.width}
              onChange={(e) =>
                savePrinterCfg({ width: Math.round((Number(e.target.value) || 384) / 8) * 8 })
              }
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={pcfg.autoUse}
            onChange={(e) => savePrinterCfg({ autoUse: e.target.checked })}
          />
          Use this printer for Inventory label printing when connected
        </label>

        {printerMsg && <div className="text-sm text-slate-600">{printerMsg}</div>}

        <div className="flex gap-2">
          <button
            disabled={!supported || printerBusy}
            onClick={handleConnect}
            className={`flex-1 py-2 rounded text-white ${
              printer.connected ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            } disabled:opacity-50`}
          >
            {printer.connected ? 'Disconnect' : 'Connect USB Printer'}
          </button>
          <button
            disabled={!printer.connected || printerBusy}
            onClick={handleTest}
            className="flex-1 border py-2 rounded hover:bg-slate-50 disabled:opacity-50"
          >
            Test Print
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 max-w-md space-y-3">
        <h2 className="font-semibold text-slate-700">App Wallpaper / Background</h2>
        <p className="text-sm text-slate-500">
          Set a custom background for the whole app using an image URL or by uploading an image.
          It overrides the default scenery. Leave empty to use the default.
        </p>

        {bgPreview && (
          <div
            className="w-full h-28 rounded border border-slate-200 bg-center bg-cover"
            style={{ backgroundImage: `url("${bgPreview}")` }}
            aria-label="Background preview"
          />
        )}

        <div>
          <label className={label}>Image URL</label>
          <input
            className={field}
            placeholder="https://example.com/wallpaper.jpg"
            value={form.background && !bgPreview.startsWith('data:') ? form.background : ''}
            onChange={(e) => {
              setForm({ ...form, background: e.target.value });
              setBgPreview(e.target.value);
            }}
          />
        </div>

        <div>
          <label className={label}>Or upload an image</label>
          <input
            type="file"
            accept="image/*"
            className="w-full text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setBgMsg('');
              if (!file) return;
              setBgBusy(true);
              try {
                const dataUrl = await fileToDataUrl(file);
                setForm({ ...form, background: dataUrl });
                setBgPreview(dataUrl);
              } catch (err) {
                setBgMsg(err.message || 'Upload failed');
              } finally {
                setBgBusy(false);
                e.target.value = '';
              }
            }}
          />
          {bgBusy && <div className="text-sm text-slate-500 mt-1">Processing image…</div>}
          {bgMsg && <div className="text-sm text-red-600 mt-1">{bgMsg}</div>}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              setForm({ ...form, background: '' });
              setBgPreview('');
            }}
            className="flex-1 border py-2 rounded hover:bg-slate-50"
          >
            Clear background
          </button>
          <button
            onClick={async () => {
              setError('');
              setBgMsg('');
              try {
                const { store } = await updateCurrentStore({ background: form.background });
                setMsg('Background saved');
                dispatch(setCurrentStoreInfo(store));
                setBgPreview(store.background || '');
              } catch (err) {
                setBgMsg(err.response?.data?.error || 'Failed to save background');
              }
            }}
            className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700"
            disabled={bgBusy}
          >
            Save Background
          </button>
        </div>
      </div>
    </div>
  );
}
