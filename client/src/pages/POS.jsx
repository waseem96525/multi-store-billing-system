import { useEffect, useRef, useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import CountUp from '../components/CountUp';
import SuccessCheck from '../components/SuccessCheck';
import { listProducts, getProductByBarcode, listFrequentProducts } from '../api/products';
import { listCustomers, createCustomer } from '../api/customers';
import {
  createInvoice,
  getInvoice,
  listInvoices,
} from '../api/invoices';
import {
  addItemQty,
  setItems,
  updateQty,
  updateItemDiscount,
  updateItemDiscountPct,
  setItemPrice,
  removeItem,
  setDiscount,
  setDiscountPct,
  setPaymentMode,
  setCustomerId,
  clearCart,
} from '../store/slices/cartSlice';
import { printReceipt } from '../utils/print';
import store from '../store';
import {
  searchCachedProducts,
  findCachedProductByCode,
  frequentFromCache,
  getCachedCustomers,
  enqueueInvoice,
  applyOfflineSale,
  parkHeld,
  listHeld,
  retrieveHeld,
  deleteHeld,
  getCatalog,
  isOnline,
} from '../offline/offlineStore';
import SendInvoiceButtons from '../components/SendInvoiceButtons';

const round2 = (n) => Math.round(n * 100) / 100;

function computeTotals(items, billDiscount, billDiscountPct) {
  let subtotal = 0;
  let taxTotal = 0;
  let itemDisc = 0;
  for (const it of items) {
    const lineSub = it.unit_price * it.qty;
    subtotal += lineSub;
    const lineDisc = it.discount_pct
      ? (lineSub * it.discount_pct) / 100
      : it.discount || 0;
    itemDisc += lineDisc;
    const taxable = lineSub - lineDisc;
    taxTotal += taxable * (it.tax_percent / 100);
  }
  const disc = billDiscountPct ? (subtotal * billDiscountPct) / 100 : billDiscount || 0;
  const grand = subtotal - itemDisc - disc + taxTotal;
  return { subtotal, taxTotal, itemDisc, disc, grand };
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
  const [showCart, setShowCart] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confetti, setConfetti] = useState([]);
  const [splitPay, setSplitPay] = useState({ cash: '', card: '', upi: '' });
  const [billDiscUnit, setBillDiscUnit] = useState('pct');
  const [itemDiscUnits, setItemDiscUnits] = useState({});
  const [recentSales, setRecentSales] = useState([]);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' });

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
      const cached = await frequentFromCache(12);
      setFrequent(cached);
    }
  }, []);

  const loadHeld = useCallback(async () => {
    try {
      setHeldBills(await listHeld());
    } catch {
      /* ignore */
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await listCustomers();
      setCustomers(data.customers || []);
    } catch {
      setCustomers(await getCachedCustomers());
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const data = await listInvoices({ limit: 5 });
      setRecentSales(data.invoices || []);
    } catch {
      /* ignore */
    }
  }, []);

  const handleAddCustomer = () => {
    if (!isOnline()) {
      addToast('Go online to add a new customer', 'error');
      return;
    }
    setNewCustomer({ name: '', phone: '', email: '' });
    setShowNewCustomer(true);
  };

  const saveNewCustomer = async (e) => {
    e.preventDefault();
    const name = newCustomer.name.trim();
    if (!name) return;
    try {
      const { customer } = await createCustomer({
        name,
        phone: newCustomer.phone.trim() || null,
        email: newCustomer.email.trim() || null,
      });
      setCustomers((c) => [...c, customer]);
      setSelectedCustomer(String(customer.id));
      dispatch(setCustomerId(customer.id));
      setShowNewCustomer(false);
      addToast(`Customer "${customer.name}" added`, 'success');
    } catch (err) {
      addToast(err.response?.data?.error || 'Could not add customer', 'error');
    }
  };

  const handleReprint = async (id) => {
    try {
      const d = await getInvoice(id);
      setReceipt({ invoice: d.invoice, items: d.items, cashier: d.cashier, store: d.store });
    } catch (e) {
      addToast(e.response?.data?.error || 'Could not load invoice', 'error');
    }
  };

  useEffect(() => {
    searchRef.current?.focus();
    loadFrequent();
    loadHeld();
    loadCustomers();
    loadRecent();
  }, [loadFrequent, loadHeld, loadCustomers, loadRecent]);

  // Debounced product search (falls back to the offline cache)
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      if (!isOnline()) {
        setResults(await searchCachedProducts(query));
        return;
      }
      try {
        const data = await listProducts({ q: query });
        setResults(data.products);
      } catch {
        const cached = await searchCachedProducts(query);
        setResults(cached);
        if (!cached.length) setError('Search failed (offline cache has nothing for this query)');
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
        setSplitPay({ cash: '', card: '', upi: '' });
        setBillDiscUnit('pct');
        setItemDiscUnits({});
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
      if (!isOnline()) {
        const product = await findCachedProductByCode(code);
        if (product) handleAdd(product);
        else setError('Product not found for "' + code + '"');
        return;
      }
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
              .catch(async () => {
                const cached = await findCachedProductByCode(code);
                if (cached) {
                  stopScanner();
                  handleAdd(cached);
                } else {
                  setScanStatus('No product for "' + code + '". Add it in Inventory.');
                  setTimeout(() => stopScanner(), 1500);
                }
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

  const { subtotal, taxTotal, itemDisc, disc, grand } = computeTotals(
    cart.items,
    cart.discount,
    cart.discountPct
  );
  const received = parseFloat(receivedCash) || 0;
  const change = received > grand ? received - grand : 0;

  // Split payment helpers
  const splitTotal = (['cash', 'card', 'upi'].reduce((s, k) => s + (parseFloat(splitPay[k]) || 0), 0));
  const splitRemaining = round2(grand - splitTotal);
  const splitCashNeed = Math.max(0, round2(grand - ((parseFloat(splitPay.card) || 0) + (parseFloat(splitPay.upi) || 0))));
  const splitChange = Math.max(0, round2((parseFloat(splitPay.cash) || 0) - splitCashNeed));
  const splitModes = ['cash', 'card', 'upi'].filter((k) => (parseFloat(splitPay[k]) || 0) > 0);

  const handleHold = async () => {
    if (cart.items.length === 0) {
      addToast('Cart is empty — nothing to park', 'error');
      return;
    }
    try {
      const payload = {
        items: cart.items,
        discount: cart.discount,
        discountPct: cart.discountPct,
        paymentMode: cart.paymentMode,
        customerId: selectedCustomer || null,
      };
      const heldBill = await parkHeld(payload, `Parked · ${cart.items.length} item(s)`);
      setHeldBills((h) => [heldBill, ...h]);
      dispatch(clearCart());
      setSelectedCustomer('');
      setReceivedCash('');
      setCreditSale(false);
      setSplitPay({ cash: '', card: '', upi: '' });
      setItemDiscUnits({});
      addToast(
        isOnline()
          ? 'Bill parked. Retrieve it anytime with F4.'
          : 'Bill parked on this device. Retrieve it anytime with F4 (even offline).',
        'success'
      );
    } catch (e) {
      addToast(e.response?.data?.error || 'Could not park bill', 'error');
    }
  };

  const handleRetrieve = async (id) => {
    try {
      const { heldBill } = await retrieveHeld(id);
      dispatch(clearCart());
      dispatch(setItems(heldBill.payload.items));
      dispatch(setDiscount(heldBill.payload.discount || 0));
      dispatch(setDiscountPct(heldBill.payload.discountPct || null));
      dispatch(setPaymentMode(heldBill.payload.paymentMode || 'cash'));
      setSelectedCustomer(heldBill.payload.customerId || '');
      setHeldBills((h) => h.filter((x) => x.id !== id));
      addToast('Bill restored to cart', 'success');
      searchRef.current?.focus();
    } catch (e) {
      addToast(e.response?.data?.error || 'Could not restore bill', 'error');
    }
  };

  const handleDeleteHeld = async (id) => {
    try {
      await deleteHeld(id);
      setHeldBills((h) => h.filter((x) => x.id !== id));
      addToast('Parked bill discarded', 'info');
    } catch {
      /* ignore */
    }
  };

  const chargeOffline = async (payload) => {
    const cat = await getCatalog();
    const products = (cat && cat.products) || [];
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const it of payload.items) {
      const p = productMap.get(Number(it.product_id));
      if (!p) throw new Error(`"${it.product_id}" is missing from the offline catalog`);
      if ((Number(p.stock_qty) || 0) < Number(it.qty)) {
        throw new Error(`Not enough stock offline for ${p.name} (${p.stock_qty} left)`);
      }
    }
    const localNo =
      'OFF-' +
      new Date().toISOString().slice(2, 10).replace(/-/g, '') +
      '-' +
      String(Math.floor(Math.random() * 900) + 100);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const selected = customers.find((c) => String(c.id) === String(selectedCustomer)) || null;
    const receiptItems = cart.items.map((i) => {
      const lineSub = i.unit_price * i.qty;
      const lineDisc = i.discount_pct ? (lineSub * i.discount_pct) / 100 : i.discount || 0;
      const taxable = lineSub - lineDisc;
      return {
        product_name: i.name,
        qty: i.qty,
        unit_price: i.unit_price,
        discount: round2(lineDisc),
        line_total: round2(taxable + (taxable * (i.tax_percent || 0)) / 100),
      };
    });
    const invoice = {
      invoice_no: localNo,
      created_at: now,
      status: payload.status,
      subtotal,
      tax_total: taxTotal,
      discount: payload.discount,
      item_discount: itemDisc,
      grand_total: grand,
      payment_mode: payload.payment_mode,
      amount_paid: payload.amount_paid,
      payment_breakdown: payload.payment_breakdown,
      pending_sync: true,
    };
    const cashier = store.getState().auth.user
      ? { name: store.getState().auth.user.name }
      : null;
    const shop = (cat && cat.store) || store.getState().store.currentStore;
    await enqueueInvoice(payload, { invoice, items: receiptItems, cashier, customer: selected, store: shop });
    await applyOfflineSale(payload);
    setReceipt({ invoice, items: receiptItems, cashier, customer: selected, store: shop });
    dispatch(clearCart());
    setShowCart(false);
    setSelectedCustomer('');
    setReceivedCash('');
    setCreditSale(false);
    setSplitPay({ cash: '', card: '', upi: '' });
    setItemDiscUnits({});
    setBillDiscUnit('pct');
    burstConfetti();
    addToast('Sale saved on this device · ' + localNo + ' — will sync automatically', 'success');
  };

  const handleCharge = async () => {
    if (cart.items.length === 0) return;
    const billDiscount = cart.discountPct
      ? round2((subtotal * cart.discountPct) / 100)
      : cart.discount || 0;
    const usingSplit = splitTotal > 0;
    if (usingSplit) {
      if (splitRemaining < -0.001) {
        addToast('Payment amounts exceed the bill total', 'error');
        return;
      }
      if (splitRemaining > 0.001 && !(creditSale && selectedCustomer)) {
        addToast('Enter the full amount or enable credit for the balance', 'error');
        return;
      }
    } else if (creditSale && !selectedCustomer) {
      addToast('Select a customer for a credit sale', 'error');
      return;
    }
    const amountPaid = usingSplit
      ? splitTotal
      : creditSale
      ? received || 0
      : grand;
    const status = usingSplit
      ? splitTotal >= grand - 0.001
        ? 'paid'
        : 'credit'
      : creditSale
      ? received >= grand
        ? 'paid'
        : 'credit'
      : 'paid';
    const dueDate = creditSale && status === 'credit'
      ? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
      : null;
    const breakdown = usingSplit
      ? splitModes.map((k) => ({ mode: k, amount: round2(parseFloat(splitPay[k]) || 0) }))
      : null;
    const payload = {
      items: cart.items.map((i) => ({
        product_id: i.product_id,
        qty: i.qty,
        unit_price: i.unit_price,
        discount: i.discount_pct
          ? round2((i.unit_price * i.qty * i.discount_pct) / 100)
          : i.discount || 0,
        tax_percent: i.tax_percent,
      })),
      discount: billDiscount,
      payment_mode: usingSplit
        ? splitModes.length === 1
          ? splitModes[0]
          : 'mixed'
        : cart.paymentMode,
      customer_id: selectedCustomer || null,
      amount_paid: amountPaid,
      status,
      due_date: dueDate,
      payment_breakdown: breakdown,
    };

    if (!isOnline()) {
      setCharging(true);
      setError('');
      try {
        await chargeOffline(payload);
      } catch (e) {
        const msg = e?.message || 'Sale failed';
        setError(msg);
        addToast(msg, 'error');
      } finally {
        setCharging(false);
      }
      return;
    }

    setCharging(true);
    setError('');
    try {
      const res = await createInvoice(payload);
      const detail = res.receipt;
      setReceipt(detail);
      dispatch(clearCart());
      setShowCart(false);
      setSelectedCustomer('');
      setReceivedCash('');
      setCreditSale(false);
      setSplitPay({ cash: '', card: '', upi: '' });
      setItemDiscUnits({});
      setBillDiscUnit('pct');
      loadFrequent();
      loadHeld();
      loadRecent();
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full pb-20 lg:pb-0">
      {/* Toasts */}
        <div className="fixed top-16 lg:top-4 right-4 z-[60] space-y-2 w-[min(92vw,18rem)]">
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

        <div className="flex flex-wrap gap-2 mb-2">
          <input
            ref={searchRef}
            className="flex-1 min-w-[140px] border rounded px-3 py-2 focus:ring-2 focus:ring-emerald-400 outline-none transition"
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

        <div className="flex-1 overflow-auto table-wrap">
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

      {/* Cart / Checkout - full column on desktop, full-screen overlay on mobile */}
      <div
        className={
          showCart
            ? 'fixed inset-0 z-50 flex flex-col bg-white rounded-lg shadow p-4 animate-fade-in'
            : 'hidden lg:flex lg:flex-col bg-white rounded-lg shadow p-4'
        }
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-slate-700">Cart</h2>
          <button
            type="button"
            onClick={() => setShowCart(false)}
            className="lg:hidden p-1 -mr-1 text-slate-500 hover:text-slate-800"
            aria-label="Close cart"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {error && <div className="text-red-600 text-sm mb-2 animate-shake">{error}</div>}

        {/* Recent sales - reprint */}
        {recentSales.length > 0 && (
          <div className="mb-2 p-2 rounded bg-slate-50 border border-slate-200">
            <div className="text-xs font-semibold text-slate-600 mb-1">
              Last sales — tap to reprint
            </div>
            <div className="flex flex-col gap-1 max-h-24 overflow-auto">
              {recentSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <button
                    className="text-left hover:underline text-slate-700"
                    onClick={() => handleReprint(s.id)}
                    title="Reprint receipt"
                  >
                    {s.invoice_no} · ₹{s.grand_total.toFixed(2)} ·{' '}
                    {new Date(s.created_at).toLocaleTimeString()}
                  </button>
                  <span className="text-slate-400">{s.cashier_name || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
                  <label className="text-xs text-slate-500">Disc</label>
                  <div className="flex items-center border rounded text-xs overflow-hidden">
                    <button
                      type="button"
                      className={
                        (itemDiscUnits[it.product_id] || 'amt') === 'pct'
                          ? 'px-1.5 py-0.5 bg-slate-800 text-white'
                          : 'px-1.5 py-0.5 text-slate-500 hover:bg-slate-100'
                      }
                      onClick={() =>
                        setItemDiscUnits((u) => ({ ...u, [it.product_id]: 'pct' }))
                      }
                    >
                      %
                    </button>
                    <button
                      type="button"
                      className={
                        (itemDiscUnits[it.product_id] || 'amt') === 'amt'
                          ? 'px-1.5 py-0.5 bg-slate-800 text-white'
                          : 'px-1.5 py-0.5 text-slate-500 hover:bg-slate-100'
                      }
                      onClick={() =>
                        setItemDiscUnits((u) => ({ ...u, [it.product_id]: 'amt' }))
                      }
                    >
                      ₹
                    </button>
                  </div>
                  {(itemDiscUnits[it.product_id] || 'amt') === 'pct' ? (
                    <>
                      <input
                        type="number"
                        className="w-14 border rounded text-xs"
                        value={it.discount_pct || 0}
                        min={0}
                        max={100}
                        onChange={(e) =>
                          dispatch(
                            updateItemDiscountPct({
                              product_id: it.product_id,
                              discount_pct: Number(e.target.value),
                            })
                          )
                        }
                      />
                      <span className="text-[10px] text-slate-400">
                        = ₹
                        {round2(
                          (it.unit_price * it.qty * (it.discount_pct || 0)) / 100
                        ).toFixed(2)}
                      </span>
                    </>
                  ) : (
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
                  )}
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
          {itemDisc > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Item Discount</span>
              <span>-₹{itemDisc.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span>Bill Discount</span>
            <div className="flex items-center gap-1">
              {[5, 10, 15, 20].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    dispatch(setDiscountPct(p));
                    setBillDiscUnit('pct');
                  }}
                  className={`px-2 py-0.5 rounded text-xs border transition ${
                    cart.discountPct === p
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-emerald-50'
                  }`}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center border rounded text-xs overflow-hidden">
              <button
                type="button"
                className={
                  billDiscUnit === 'pct'
                    ? 'px-2 py-0.5 bg-slate-800 text-white'
                    : 'px-2 py-0.5 text-slate-500 hover:bg-slate-100'
                }
                onClick={() => setBillDiscUnit('pct')}
              >
                %
              </button>
              <button
                type="button"
                className={
                  billDiscUnit === 'amt'
                    ? 'px-2 py-0.5 bg-slate-800 text-white'
                    : 'px-2 py-0.5 text-slate-500 hover:bg-slate-100'
                }
                onClick={() => setBillDiscUnit('amt')}
              >
                ₹
              </button>
            </div>
            {billDiscUnit === 'pct' ? (
              <>
                <input
                  type="number"
                  className="w-16 border rounded text-right"
                  value={cart.discountPct || 0}
                  min={0}
                  max={100}
                  onChange={(e) => dispatch(setDiscountPct(Number(e.target.value)))}
                />
                <span className="text-xs text-slate-400">= ₹{disc.toFixed(2)}</span>
              </>
            ) : (
              <input
                type="number"
                className="w-20 border rounded text-right"
                value={cart.discount || 0}
                min={0}
                onChange={(e) => dispatch(setDiscount(Number(e.target.value)))}
              />
            )}
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

          {/* Split payment */}
          {!creditSale && cart.items.length > 0 && (
            <div className="rounded bg-slate-50 p-2 mt-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-600">Split payment</span>
                {splitTotal > 0 && (
                  <span
                    className={`text-xs font-medium ${
                      splitRemaining > 0.001
                        ? 'text-amber-600'
                        : splitRemaining < -0.001
                        ? 'text-red-600'
                        : 'text-emerald-600'
                    }`}
                  >
                    {splitRemaining > 0.001
                      ? `Remaining ₹${splitRemaining.toFixed(2)}`
                      : splitRemaining < -0.001
                      ? `Over by ₹${Math.abs(splitRemaining).toFixed(2)}`
                      : 'Fully paid'}
                  </span>
                )}
              </div>
              {['cash', 'card', 'upi'].map((k) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-xs capitalize text-slate-500">{k}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      className="w-24 border rounded text-right text-sm"
                      placeholder="0.00"
                      value={splitPay[k]}
                      onChange={(e) => setSplitPay((s) => ({ ...s, [k]: e.target.value }))}
                    />
                    <button
                      type="button"
                      title="Pay the remaining amount with this mode"
                      onClick={() =>
                        setSplitPay((s) => ({
                          ...s,
                          [k]: Math.max(0, splitRemaining).toFixed(2),
                        }))
                      }
                      className="px-1.5 py-0.5 rounded border text-[10px] text-slate-500 hover:bg-slate-100"
                    >
                      All
                    </button>
                  </div>
                </div>
              ))}
              {splitModes.length > 0 && (
                <div className="flex justify-between mt-1 text-xs">
                  <span>Paid</span>
                  <span className="font-semibold">₹{splitTotal.toFixed(2)}</span>
                </div>
              )}
              {splitChange > 0 && (
                <div className="flex justify-between mt-1 text-xs font-semibold text-emerald-600">
                  <span>Cash change</span>
                  <span>₹{splitChange.toFixed(2)}</span>
                </div>
              )}
              {splitRemaining > 0.001 && (
                <div className="mt-1 text-[10px] text-amber-600">
                  Balance will be billed as credit — select a customer and enable "Bill as
                  credit".
                </div>
              )}
            </div>
          )}

          {/* Cash change calculator */}
          {cart.paymentMode === 'cash' && !creditSale && splitTotal === 0 && (
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
              onChange={(e) => {
                setCreditSale(e.target.checked);
                if (e.target.checked) setSplitPay({ cash: '', card: '', upi: '' });
              }}
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
            <span>
              <CountUp value={grand} decimals={2} prefix="₹" />
            </span>
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

      {/* Mobile cart bottom bar */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-800 text-white flex items-center justify-between px-4 py-3 shadow-lg">
        <div>
          <div className="text-xs text-slate-300">{cart.items.length} item(s)</div>
          <div className="font-bold text-lg">
            <CountUp value={grand} decimals={2} prefix="₹" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCart(true)}
          className="bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-medium active:scale-95 transition"
        >
          View Cart
        </button>
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

      {/* New customer modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
          <form
            onSubmit={saveNewCustomer}
            className="bg-white rounded-lg p-4 w-[min(92vw,22rem)] space-y-3"
          >
            <h3 className="font-semibold">New customer</h3>
            <input
              autoFocus
              required
              placeholder="Name *"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={newCustomer.name}
              onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
            />
            <input
              placeholder="Phone (for WhatsApp delivery)"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
            />
            <input
              placeholder="Email (for invoice delivery)"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={newCustomer.email}
              onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-emerald-600 text-white py-2 rounded hover:bg-emerald-700"
              >
                Add
              </button>
              <button
                type="button"
                className="flex-1 border py-2 rounded hover:bg-slate-50"
                onClick={() => setShowNewCustomer(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white p-6 rounded-lg w-[min(92vw,20rem)] max-h-[90vh] overflow-auto receipt-pop">
            <SuccessCheck className="mb-2" />
            {receipt.invoice.pending_sync && (
              <div className="text-center text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-1.5 mb-2">
                ⚠ Saved on this device — will upload automatically when the
                internet returns.
              </div>
            )}
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
                {receipt.invoice.item_discount > 0 && (
                  <div className="flex justify-between">
                    <span>Item Discount</span>
                    <span>₹{receipt.invoice.item_discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>₹{receipt.invoice.discount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span>₹{receipt.invoice.grand_total.toFixed(2)}</span>
                </div>
                {receipt.invoice.payment_breakdown &&
                receipt.invoice.payment_breakdown.length > 0 ? (
                  <div className="text-xs mt-1 border-t pt-1">
                    <div className="flex justify-between font-semibold mb-0.5">
                      <span>Payment split</span>
                      <span>₹{receipt.invoice.grand_total.toFixed(2)}</span>
                    </div>
                    {receipt.invoice.payment_breakdown.map((b) => (
                      <div key={b.mode} className="flex justify-between">
                        <span className="capitalize">{b.mode}</span>
                        <span>₹{Number(b.amount).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs mt-1">Mode: {receipt.invoice.payment_mode}</div>
                )}
                {receipt.invoice.status === 'credit' && (
                  <div className="text-xs mt-1 text-amber-600">
                    Balance due: ₹
                    {(
                      receipt.invoice.grand_total - (receipt.invoice.amount_paid || 0)
                    ).toFixed(2)}
                  </div>
                )}
              </div>
              {receipt.store?.receipt_footer ? (
                <div className="text-center text-xs mt-3">{receipt.store.receipt_footer}</div>
              ) : (
                <div className="text-center text-xs mt-3">Thank you!</div>
              )}
            </div>
            {!receipt.invoice.pending_sync && (
              <SendInvoiceButtons detail={receipt} className="mt-3" />
            )}
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
