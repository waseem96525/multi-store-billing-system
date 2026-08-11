import { useEffect, useRef, useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { listProducts, getProductByBarcode, listFrequentProducts } from '../api/products';
import { listCustomers, createCustomer } from '../api/customers';
import {
  createInvoice,
  getInvoice,
  holdInvoice,
  listHeldInvoices,
  retrieveHeldInvoice,
  deleteHeldInvoice,
} from '../api/invoices';
import {
  addItemQty,
  setItems,
  updateQty,
  updateItemDiscount,
  setItemPrice,
  removeItem,
  setDiscount,
  setPaymentMode,
  setCustomerId,
  clearCart,
} from '../store/slices/cartSlice';
import { printReceipt } from '../utils/print';

function computeTotals(items, billDiscount) {
  let subtotal = 0;
  let taxTotal = 0;
  for (const it of items) {
    const lineSub = it.unit_price * it.qty;
    subtotal += lineSub;
    const taxable = lineSub - (it.discount || 0);
    taxTotal += taxable * (it.tax_percent / 100);
  }
  const grand = subtotal - (billDiscount || 0) + taxTotal;
  return { subtotal, taxTotal, grand };
}

export default function POS() {
  const dispatch = useDispatch();
  const cart = useSelector((s) => s.cart);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [charging, setCharging] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [addQty, setAddQty] = useState(1);
  const [frequent, setFrequent] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [heldBills, setHeldBills] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [editingPrice, setEditingPrice] = useState(null);
  const [receivedCash, setReceivedCash] = useState('');
  const [creditSale, setCreditSale] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confetti, setConfetti] = useState([]);

  const searchRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const scanningRef = useRef(false);
  const lastScannedRef = useRef(new Set());

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const burstConfetti = useCallback(() => {
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const pieces = Array.from({ length: 36 }, (_, i) => ({
      id: Date.now() + i,
      left: Math.random() * 100,
      color: colors[i % colors.length],
      delay: Math.random() * 0.4,
      rot: Math.random() * 360,
    }));
    setConfetti(pieces);
    setTimeout(() => setConfetti([]), 2600);
  }, []);

  const loadFrequent = useCallback(async () => {
    try {
      const data = await listFrequentProducts(12);
      setFrequent(data.products || []);
    } catch {
      /* shelf optional */
    }
  }, []);

  const loadHeld = useCallback(async () => {
    try {
      const data = await listHeldInvoices();
      setHeldBills(data.heldBills || []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await listCustomers();
      setCustomers(data.customers || []);
    } catch {
      /* ignore */
    }
  }, []);

  const handleAddCustomer = async () => {
    const name = window.prompt('New customer name:');
    if (!name || !name.trim()) return;
    try {
      const { customer } = await createCustomer({ name: name.trim() });
      setCustomers((c) => [...c, customer]);
      setSelectedCustomer(String(customer.id));
      dispatch(setCustomerId(customer.id));
      addToast(`Customer "${customer.name}" added`, 'success');
    } catch (e) {
      addToast(e.response?.data?.error || 'Could not add customer', 'error');
    }
  };

  useEffect(() => {
    searchRef.current?.focus();
    loadFrequent();
    loadHeld();
    loadCustomers();
  }, [loadFrequent, loadHeld, loadCustomers]);

  // Debounced product search
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      try {
        const data = await listProducts({ q: query });
        setResults(data.products);
      } catch (e) {
        setError(e.response?.data?.error || 'Search failed');
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        if (!scanning) startScanner();
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleHold();
      } else if (e.key === 'F4') {
        e.preventDefault();
        loadHeld().then(() => addToast(`${heldBills.length} parked bill(s) ready`, 'info'));
      } else if (e.key === 'F5') {
        e.preventDefault();
        dispatch(clearCart());
        setSelectedCustomer('');
        setReceivedCash('');
        setCreditSale(false);
        addToast('Cart cleared', 'info');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, heldBills.length]);

  const handleAdd = useCallback(
    (product, qty = addQty) => {
      dispatch(addItemQty({ product, qty: Number(qty) || 1 }));
      setQuery('');
      setResults([]);
      searchRef.current?.focus();
    },
    [dispatch, addQty]
  );

  const handleKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length) {
        handleAdd(results[0]);
        return;
      }
      const code = query.trim();
      if (!code) return;
      try {
        const { product } = await getProductByBarcode(code);
        handleAdd(product);
      } catch {
        setError('Product not found for "' + code + '"');
      }
    }
  };

  // ---- Barcode / QR camera scanner ----
  const detectLoop = useCallback(() => {
    if (!scanningRef.current) return;
    const BD = window.BarcodeDetector;
    if (!BD) {
      setScanStatus('Barcode scanning is not supported here. Type the barcode instead.');
      return;
    }
    if (!detectorRef.current) {
      try {
        detectorRef.current = new BD({
          formats: [
            'qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e',
            'code_128', 'code_39', 'itf', 'pdf417', 'data_matrix', 'aztec',
          ],
        });
      } catch {
        setScanStatus('Could not initialise barcode detector.');
        return;
      }
    }
    const video = videoRef.current;
    if (!video) return;
    detectorRef.current
      .detect(video)
      .then((codes) => {
        if (codes && codes.length) {
          for (const c of codes) {
            const code = c.rawValue;
            if (lastScannedRef.current.has(code)) continue;
            lastScannedRef.current.add(code);
            setScanStatus('Found: ' + code);
            getProductByBarcode(code)
              .then(({ product }) => {
                stopScanner();
                handleAdd(product);
              })
              .catch(() => {
                setScanStatus('No product for "' + code + '". Add it in Inventory.');
                setTimeout(() => stopScanner(), 1500);
              });
            return;
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (scanningRef.current) setTimeout(detectLoop, 400);
      });
  }, [handleAdd]);

  const startScanner = useCallback(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Camera not supported. Please type or scan the barcode into the search box.');
      return;
    }
    setScanning(true);
    setScanStatus('Starting camera…');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        streamRef.current = stream;
        scanningRef.current = true;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setScanStatus('Point the camera at a barcode / QR code');
        detectLoop();
      })
      .catch((err) => {
        setScanning(false);
        scanningRef.current = false;
        setScanStatus('Camera error: ' + (err?.message || err));
      });
  }, [detectLoop]);

  const stopScanner = useCallback(() => {
    scanningRef.current = false;
    setScanning(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    detectorRef.current = null;
    lastScannedRef.current.clear();
  }, []);

  const { subtotal, taxTotal, grand } = computeTotals(cart.items, cart.discount);
  const received = parseFloat(receivedCash) || 0;
  const change = received > grand ? received - grand : 0;

  const handleHold = async () => {
    if (cart.items.length === 0) {
      addToast('Cart is empty — nothing to park', 'error');
      return;
    }
    try {
      const payload = {
        items: cart.items,
        discount: cart.discount,
        paymentMode: cart.paymentMode,
        customerId: selectedCustomer || null,
      };
      const res = await holdInvoice({
        payload,
        label: `Parked · ${cart.items.length} item(s)`,
      });
      setHeldBills((h) => [res.heldBill, ...h]);
      dispatch(clearCart());
      setSelectedCustomer('');
      setReceivedCash('');
      setCreditSale(false);
      addToast('Bill parked. Retrieve it anytime with F4.', 'success');
    } catch (e) {
      addToast(e.response?.data?.error || 'Could not park bill', 'error');
    }
  };

  const handleRetrieve = async (id) => {
    try {
      const { heldBill } = await retrieveHeldInvoice(id);
      dispatch(clearCart());
      dispatch(setItems(heldBill.payload.items));
      dispatch(setDiscount(heldBill.payload.discount || 0));
      dispatch(setPaymentMode(heldBill.payload.paymentMode || 'cash'));
      setSelectedCustomer(heldBill.payload.customerId || '');
      setHeldBills((h) => h.filter((x) => x.id !== id));
      await deleteHeldInvoice(id);
      addToast('Bill restored to cart', 'success');
      searchRef.current?.focus();
    } catch (e) {
      addToast(e.response?.data?.error || 'Could not restore bill', 'error');
    }
  };

  const handleDeleteHeld = async (id) => {
    try {
      await deleteHeldInvoice(id);
      setHeldBills((h) => h.filter((x) => x.id !== id));
      addToast('Parked bill discarded', 'info');
    } catch {
      /* ignore */
    }
  };

  const handleCharge = async () => {
    if (cart.items.length === 0) return;
    if (creditSale && !selectedCustomer) {
      addToast('Select a customer for a credit sale', 'error');
      return;
    }
    setCharging(true);
    setError('');
    try {
      const amountPaid = creditSale ? received || 0 : grand;
      const status = creditSale
        ? received >= grand
          ? 'paid'
          : 'credit'
        : 'paid';
      const dueDate = creditSale && status === 'credit'
        ? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
        : null;
      const payload = {
        items: cart.items.map((i) => ({
          product_id: i.product_id,
          qty: i.qty,
          unit_price: i.unit_price,
          discount: i.discount,
          tax_percent: i.tax_percent,
        })),
        discount: cart.discount,
        payment_mode: cart.paymentMode,
        customer_id: selectedCustomer || null,
        amount_paid: amountPaid,
        status,
        due_date: dueDate,
      };
      const res = await createInvoice(payload);
      const detail = await getInvoice(res.invoice.invoiceId);
      setReceipt(detail);
      dispatch(clearCart());
      setSelectedCustomer('');
      setReceivedCash('');
      setCreditSale(false);
      loadFrequent();
      loadHeld();
      burstConfetti();
      addToast('Sale saved · ' + res.invoice.invoiceNo, 'success');
    } catch (e) {
      setError(e.response?.data?.error || 'Sale failed');
      addToast(e.response?.data?.error || 'Sale failed', 'error');
    } finally {
      setCharging(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-[60] space-y-2 w-72">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter px-4 py-2 rounded-lg shadow-lg text-sm text-white animate-fade-in ${
              t.type === 'error'
                ? 'bg-red-500'
                : t.type === 'info'
                ? 'bg-slate-700'
                : 'bg-emerald-500'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Confetti */}
      {confetti.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
          {confetti.map((c) => (
            <span
              key={c.id}
              className="confetti-piece"
              style={{
                left: c.left + '%',
                background: c.color,
                animationDelay: c.delay + 's',
                transform: `rotate(${c.rot}deg)`,
              }}
            />
          ))}
        </div>
      )}

      {/* Product search + catalog */}
      <div className="lg:col-span-2 bg-white rounded-lg shadow p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-slate-800">Point of Sale</h1>
          <button
            type="button"
            onClick={handleHold}
            className="text-xs px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition"
            title="Park current bill (F3)"
          >
            ⏸ Park (F3)
          </button>
        </div>

        <div className="flex gap-2 mb-2">
          <input
            ref={searchRef}
            className="flex-1 border rounded px-3 py-2 focus:ring-2 focus:ring-emerald-400 outline-none transition"
            placeholder="Search by name / SKU / barcode (or scan)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <input
            type="number"
            min={1}
            className="w-16 border rounded px-2 py-2 text-center"
            title="Quantity to add"
            value={addQty}
            onChange={(e) => setAddQty(Math.max(1, Number(e.target.value) || 1))}
          />
          <button
            type="button"
            onClick={startScanner}
            className="scan-btn px-3 py-2 rounded text-white font-medium"
            title="Scan barcode / QR (F2)"
          >
            📷 Scan
          </button>
        </div>

        {/* Quick-add shelf */}
        {frequent.length > 0 && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-slate-500 mb-1">Quick Add</div>
            <div className="flex flex-wrap gap-2">
              {frequent.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleAdd(p)}
                  className="quick-chip px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-sm transition"
                  style={{ animationDelay: i * 40 + 'ms' }}
                  title={`${p.sku || ''} · stock ${p.stock_qty}`}
                >
                  <span className="font-medium">{p.name}</span>{' '}
                  <span className="text-slate-500">₹{p.selling_price}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {results.length === 0 ? (
            <div className="text-slate-400 text-sm">
              Type to search products, or use Scan to read a barcode / QR code…
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {results.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => handleAdd(p)}
                    className="result-row border-b cursor-pointer hover:bg-emerald-50 transition"
                  >
                    <td className="py-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-slate-400">
                        SKU: {p.sku || '-'} | Stock: {p.stock_qty}
                        {p.barcode ? ` | ${p.barcode}` : ''}
                      </div>
                    </td>
                    <td className="text-right py-2 font-semibold">₹{p.selling_price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cart / Checkout */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-col">
        <h2 className="font-semibold text-slate-700 mb-2">Cart</h2>
        {error && <div className="text-red-600 text-sm mb-2 animate-shake">{error}</div>}

        {/* Parked bills */}
        {heldBills.length > 0 && (
          <div className="mb-2 p-2 rounded bg-amber-50 border border-amber-200">
            <div className="text-xs font-semibold text-amber-700 mb-1">
              Parked bills ({heldBills.length}) — F4 to refresh
            </div>
            <div className="flex flex-col gap-1 max-h-24 overflow-auto">
              {heldBills.map((h) => (
                <div key={h.id} className="flex items-center justify-between text-xs">
                  <button
                    className="text-left hover:underline text-amber-800"
                    onClick={() => handleRetrieve(h.id)}
                  >
                    {h.label || 'Parked bill'} · {new Date(h.created_at).toLocaleTimeString()}
                  </button>
                  <button
                    className="text-red-500 hover:text-red-700"
                    onClick={() => handleDeleteHeld(h.id)}
                    title="Discard"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto space-y-2">
          {cart.items.length === 0 ? (
            <div className="text-slate-400 text-sm">Cart is empty</div>
          ) : (
            cart.items.map((it) => (
              <div
                key={it.product_id}
                className="cart-item border rounded p-2 text-sm animate-slide-in"
              >
                <div className="flex justify-between">
                  <span className="font-medium">{it.name}</span>
                  <button
                    className="text-red-500 text-xs hover:text-red-700"
                    onClick={() => dispatch(removeItem(it.product_id))}
                  >
                    Remove
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    className="px-2 border rounded hover:bg-slate-100"
                    onClick={() =>
                      dispatch(updateQty({ product_id: it.product_id, qty: it.qty - 1 }))
                    }
                  >
                    −
                  </button>
                  <input
                    type="number"
                    className="w-14 border rounded text-center"
                    value={it.qty}
                    min={1}
                    onChange={(e) =>
                      dispatch(
                        updateQty({ product_id: it.product_id, qty: Number(e.target.value) })
                      )
                    }
                  />
                  <button
                    className="px-2 border rounded hover:bg-slate-100"
                    onClick={() =>
                      dispatch(updateQty({ product_id: it.product_id, qty: it.qty + 1 }))
                    }
                  >
                    +
                  </button>
                  {editingPrice === it.product_id ? (
                    <input
                      autoFocus
                      type="number"
                      className="w-20 border rounded text-right"
                      defaultValue={it.unit_price}
                      onBlur={(e) => {
                        dispatch(
                          setItemPrice({
                            product_id: it.product_id,
                            unit_price: e.target.value,
                          })
                        );
                        setEditingPrice(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.target.blur();
                      }}
                    />
                  ) : (
                    <button
                      className="ml-auto text-slate-500 hover:text-emerald-600 underline decoration-dotted"
                      title="Click to override price"
                      onClick={() => setEditingPrice(it.product_id)}
                    >
                      @ ₹{it.unit_price}
                    </button>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <label className="text-xs text-slate-500">Disc ₹</label>
                  <input
                    type="number"
                    className="w-16 border rounded text-xs"
                    value={it.discount || 0}
                    min={0}
                    onChange={(e) =>
                      dispatch(
                        updateItemDiscount({
                          product_id: it.product_id,
                          discount: Number(e.target.value),
                        })
                      )
                    }
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 border-t pt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>₹{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tax</span>
            <span>₹{taxTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span>Bill Discount ₹</span>
            <input
              type="number"
              className="w-20 border rounded text-right"
              value={cart.discount || 0}
              min={0}
              onChange={(e) => dispatch(setDiscount(Number(e.target.value)))}
            />
          </div>

          {/* Customer */}
          <div className="flex justify-between items-center pt-1">
            <span>Customer</span>
            <div className="flex items-center gap-1">
              <select
                className="w-36 border rounded px-2 py-1"
                value={selectedCustomer}
                onChange={(e) => {
                  setSelectedCustomer(e.target.value || '');
                  dispatch(setCustomerId(e.target.value || null));
                }}
              >
                <option value="">Walk-in</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddCustomer}
                title="Add new customer"
                className="px-2 py-1 rounded bg-slate-800 text-white text-xs hover:bg-slate-700"
              >
                +
              </button>
            </div>
          </div>

          {/* Payment mode */}
          <select
            className="w-full border rounded px-2 py-1 mt-1"
            value={cart.paymentMode}
            onChange={(e) => dispatch(setPaymentMode(e.target.value))}
          >
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="upi">UPI / Other</option>
          </select>

          {/* Cash change calculator */}
          {cart.paymentMode === 'cash' && !creditSale && (
            <div className="rounded bg-slate-50 p-2 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Cash received ₹</span>
                <input
                  type="number"
                  className="w-24 border rounded text-right text-sm"
                  placeholder="0.00"
                  value={receivedCash}
                  onChange={(e) => setReceivedCash(e.target.value)}
                />
              </div>
              {received > 0 && (
                <div className="flex justify-between mt-1 font-semibold">
                  <span className={change > 0 ? 'text-emerald-600' : 'text-slate-600'}>
                    Change ₹
                  </span>
                  <span className="text-emerald-600">{change.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          {/* Credit toggle */}
          <label className="flex items-center gap-2 mt-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={creditSale}
              onChange={(e) => setCreditSale(e.target.checked)}
            />
            Bill as credit (customer pays later)
          </label>
          {creditSale && (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">
              Amount received now ₹
              <input
                type="number"
                className="w-24 border rounded text-right ml-2"
                placeholder="0.00"
                value={receivedCash}
                onChange={(e) => setReceivedCash(e.target.value)}
              />
              {received < grand && received >= 0 && (
                <div className="mt-1">
                  Balance due: ₹{(grand - received).toFixed(2)} (due in 30 days)
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between font-bold text-lg pt-1">
            <span>Grand Total</span>
            <span>₹{grand.toFixed(2)}</span>
          </div>

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={handleHold}
              className="flex-1 border border-amber-300 text-amber-700 py-2 rounded hover:bg-amber-50"
            >
              Park
            </button>
            <button
              className="flex-1 bg-emerald-600 text-white py-2 rounded hover:bg-emerald-700 disabled:opacity-50 transition"
              disabled={cart.items.length === 0 || charging}
              onClick={handleCharge}
            >
              {charging ? 'Processing…' : 'Charge & Print'}
            </button>
          </div>
        </div>
      </div>

      {/* Scanner modal */}
      {scanning && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-lg p-4 w-[90%] max-w-md">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">Scan Barcode / QR</h3>
              <button className="text-slate-500" onClick={stopScanner}>
                ✕
              </button>
            </div>
            <div className="relative rounded overflow-hidden bg-black aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
              />
              <div className="scanner-line" />
              <div className="scanner-corner tl" />
              <div className="scanner-corner tr" />
              <div className="scanner-corner bl" />
              <div className="scanner-corner br" />
            </div>
            <div className="mt-2 text-sm text-center text-slate-600 min-h-[1.5rem]">
              {scanStatus}
            </div>
            <button className="w-full mt-2 border py-2 rounded" onClick={stopScanner}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white p-6 rounded-lg w-80 max-h-[90vh] overflow-auto receipt-pop">
            <div id="receipt" className="text-sm">
              <div className="text-center font-bold mb-1">{receipt.store?.name || 'RETAIL SHOP'}</div>
              {receipt.store?.address && (
                <div className="text-center text-xs text-slate-600">{receipt.store.address}</div>
              )}
              {receipt.store?.phone && (
                <div className="text-center text-xs text-slate-600">Ph: {receipt.store.phone}</div>
              )}
              {receipt.store?.gstin && (
                <div className="text-center text-xs text-slate-600">GSTIN: {receipt.store.gstin}</div>
              )}
              <div className="text-center text-xs mb-3">
                Invoice: {receipt.invoice.invoice_no}
                <br />
                {new Date(receipt.invoice.created_at).toLocaleString()}
                <br />
                Cashier: {receipt.cashier?.name}
                {receipt.invoice.status === 'credit' && (
                  <span className="text-amber-600"> · CREDIT</span>
                )}
              </div>
              <table className="w-full">
                <tbody>
                  {receipt.items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        {it.product_name}
                        <br />
                        <span className="text-xs">
                          {it.qty} x ₹{it.unit_price}
                          {it.discount ? ` (-₹${it.discount})` : ''}
                        </span>
                      </td>
                      <td className="text-right">₹{it.line_total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t mt-2 pt-2">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>₹{receipt.invoice.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>₹{receipt.invoice.tax_total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>₹{receipt.invoice.discount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span>₹{receipt.invoice.grand_total.toFixed(2)}</span>
                </div>
                <div className="text-xs mt-1">Mode: {receipt.invoice.payment_mode}</div>
              </div>
              {receipt.store?.receipt_footer ? (
                <div className="text-center text-xs mt-3">{receipt.store.receipt_footer}</div>
              ) : (
                <div className="text-center text-xs mt-3">Thank you!</div>
              )}
            </div>
            <div className="mt-4 flex gap-2 no-print">
              <button
                className="flex-1 bg-slate-800 text-white py-2 rounded hover:bg-slate-700"
                onClick={printReceipt}
              >
                Print
              </button>
              <button
                className="flex-1 border py-2 rounded hover:bg-slate-50"
                onClick={() => setReceipt(null)}
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
