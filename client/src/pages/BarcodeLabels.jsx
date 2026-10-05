import { useEffect, useMemo, useState } from 'react';
import { listProducts, listCategories } from '../api/products';
import { useSelector } from 'react-redux';
import { can, PERM } from '../utils/permissions';
import useLiveCatalog from '../realtime/useLiveCatalog';
import {
  printLabels,
  buildLabelSheet,
  LABEL_SIZES,
  DEFAULT_LABEL_OPTIONS,
} from '../utils/print';
import {
  subscribe as subscribePrinter,
  isConnected as printerConnected,
  connect as printerConnect,
  disconnect as printerDisconnect,
  printLabels as printSerialLabels,
} from '../utils/serialPrinter';

const PREVIEW_SCOPE = '#label-preview';

export default function BarcodeLabels() {
  const user = useSelector((s) => s.auth.user);
  const allowed = can(user, PERM.INVENTORY_VIEW);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sel, setSel] = useState({});
  const [options, setOptions] = useState(DEFAULT_LABEL_OPTIONS);
  const [printer, setPrinter] = useState({ supported: false, connected: false, portName: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    const [p, c] = await Promise.all([listProducts(), listCategories()]);
    setProducts(p.products);
    setCategories(c.categories);
  };

  useEffect(() => {
    load().catch((e) => setMsg({ kind: 'error', text: e.response?.data?.error || 'Load failed' }));
  }, []);

  const live = useLiveCatalog();
  useEffect(() => {
    if (!live.ready) return;
    const t = setTimeout(load, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.version]);

  useEffect(() => subscribePrinter(setPrinter), []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryId && String(p.category_id) !== String(categoryId)) return false;
      if (!needle) return true;
      return (
        String(p.name || '').toLowerCase().includes(needle) ||
        String(p.sku || '').toLowerCase().includes(needle) ||
        String(p.barcode || '').includes(needle)
      );
    });
  }, [products, q, categoryId]);

  const codeOf = (p) => p.barcode || p.sku || String(p.id);
  const hasRealCode = (p) => !!(p.barcode || p.sku);

  const selected = useMemo(() => filtered.filter((p) => sel[p.id]), [filtered, sel]);

  const items = useMemo(
    () =>
      selected.map((p) => ({
        name: p.name,
        price: Number(p.selling_price || 0),
        mrp: Number(p.mrp || 0) || undefined,
        code: codeOf(p),
        copies: Number(sel[p.id]) || 1,
      })),
    [selected, sel]
  );

  const totalLabels = useMemo(
    () => items.reduce((n, it) => n + (Number(it.copies) || 1), 0),
    [items]
  );

  const preview = useMemo(() => {
    const sample = items.slice(0, 12);
    if (!sample.length) return { html: '', total: 0 };
    return buildLabelSheet(sample, options, PREVIEW_SCOPE);
  }, [items, options]);

  const setOpt = (patch) => setOptions((o) => ({ ...o, ...patch }));

  const toggle = (p) =>
    setSel((s) => {
      const next = { ...s };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = 1;
      return next;
    });

  const setCopies = (id, n) =>
    setSel((s) => ({ ...s, [id]: Math.max(1, Math.min(999, Number(n) || 1)) }));

  const selectAll = () => setSel(Object.fromEntries(filtered.map((p) => [p.id, 1])));
  const clear = () => setSel({});

  const selectedVisible = filtered.length > 0 && filtered.every((p) => sel[p.id]);
  const toggleAll = () => (selectedVisible ? clear() : selectAll());

  const handleBrowserPrint = () => {
    if (!items.length) return;
    const n = printLabels(items, options);
    setMsg({ kind: 'ok', text: `Sent ${n} label(s) to the print dialog` });
  };

  const handleSerialPrint = async () => {
    if (!items.length) return;
    if (!printer.connected) {
      setMsg({ kind: 'error', text: 'USB printer not connected (set it up in Settings)' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const n = await printSerialLabels(items);
      setMsg({ kind: 'ok', text: `Sent ${n} label(s) to ${printer.portName}` });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message || 'Print failed' });
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (printer.connected) await printerDisconnect();
      else await printerConnect();
    } catch (e) {
      setMsg({ kind: 'error', text: e.message || 'Printer connection failed' });
    } finally {
      setBusy(false);
    }
  };

  const missingCodes = selected.filter((p) => !hasRealCode(p)).length;

  if (!allowed) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-800">Barcode Labels</h1>
        <div className="text-red-600 text-sm">You do not have permission to view this page.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Barcode Labels</h1>
          <p className="text-sm text-slate-500">
            {selected.length} product(s) selected — {totalLabels} label(s) to print
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {printer.supported && (
            <button
              className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200 disabled:opacity-50"
              onClick={handleConnect}
              disabled={busy}
            >
              {printer.connected ? 'Disconnect' : 'Connect USB printer'}
            </button>
          )}
          <button
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
            onClick={handleBrowserPrint}
            disabled={!items.length}
          >
            Print (browser)
          </button>
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={handleSerialPrint}
            disabled={!items.length || !printer.connected || busy}
          >
            Print to USB printer
          </button>
        </div>
      </div>

      {!printer.supported && (
        <div className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded p-2">
          USB label printing needs Chrome or Edge over HTTPS or localhost. Browser printing works
          everywhere.
        </div>
      )}
      {printer.supported && !printer.connected && (
        <div className="text-slate-600 text-sm">
          USB printer: not connected ({printer.portName}).
        </div>
      )}
      {msg && (
        <div className={msg.kind === 'ok' ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
          {msg.text}
        </div>
      )}
      {missingCodes > 0 && (
        <div className="text-amber-700 text-sm">
          {missingCodes} selected product(s) have no barcode or SKU — the internal ID will be encoded.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="space-y-3">
          <div className="bg-white rounded-lg shadow p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                className="border rounded px-3 py-2 flex-1 min-w-[12rem]"
                placeholder="Search name, SKU or barcode..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select
                className="border rounded px-2 py-2"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <label className="flex items-center gap-2">
                Copies
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="w-20 border rounded px-2 py-1"
                  value={options.copies}
                  onChange={(e) => setOpt({ copies: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
              <label className="flex items-center gap-2">
                Label size
                <select
                  className="border rounded px-2 py-1"
                  value={options.size}
                  onChange={(e) => setOpt({ size: e.target.value })}
                >
                  {Object.keys(LABEL_SIZES).map((k) => (
                    <option key={k} value={k}>
                      {k.replace('x', ' x ')} mm
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={options.showName}
                  onChange={(e) => setOpt({ showName: e.target.checked })}
                />
                Name
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={options.showPrice}
                  onChange={(e) => setOpt({ showPrice: e.target.checked })}
                />
                Price
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={options.showMrp}
                  onChange={(e) => setOpt({ showMrp: e.target.checked })}
                />
                MRP
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={options.showCode}
                  onChange={(e) => setOpt({ showCode: e.target.checked })}
                />
                Code text
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={options.incrementCode}
                  onChange={(e) => setOpt({ incrementCode: e.target.checked })}
                />
                Sequential barcodes
              </label>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b text-sm">
              <button className="text-blue-600" onClick={toggleAll}>
                {selectedVisible ? 'Clear all' : 'Select all'}
              </button>
              <span className="text-slate-500">
                {filtered.length} shown
                {selected.length !== filtered.length ? ` · ${selected.length} selected` : ''}
              </span>
            </div>
            <div className="max-h-[26rem] overflow-auto divide-y">
              {filtered.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={!!sel[p.id]}
                    onChange={() => toggle(p)}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium text-slate-700">{p.name}</span>
                    <span className="block text-xs text-slate-400">
                      {hasRealCode(p) ? codeOf(p) : `no barcode — will use #${p.id}`}
                    </span>
                  </span>
                  <span className="font-semibold whitespace-nowrap">
                    Rs {Number(p.selling_price || 0).toFixed(2)}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    disabled={!sel[p.id]}
                    className="w-16 border rounded px-2 py-1 text-sm disabled:opacity-40"
                    value={sel[p.id] || 1}
                    onChange={(e) => setCopies(p.id, e.target.value)}
                    onClick={(e) => e.preventDefault()}
                  />
                </label>
              ))}
              {filtered.length === 0 && (
                <div className="p-6 text-center text-slate-400 text-sm">
                  {products.length === 0 ? 'No products in inventory' : 'No products match the filter'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Preview</h2>
            <span className="text-xs text-slate-400">
              {preview.total ? `first ${preview.total} of ${totalLabels}` : 'nothing selected'}
            </span>
          </div>
          <div
            id="label-preview"
            className="mt-3 overflow-auto max-h-[30rem] rounded border border-dashed border-slate-300 bg-slate-50 p-2"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
          {items.length > 12 && (
            <p className="mt-2 text-xs text-slate-400">
              Preview shows the first 12 labels; the printed sheet includes all {totalLabels}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}