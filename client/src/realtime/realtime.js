// Real-time sync engine.
//
// Uses Firebase Realtime Database's REST streaming endpoint (server-sent
// events) directly from the browser with the user's Firebase ID token, so
// product / stock / customer / store changes made on ANY device appear on
// this device within a second or two - no polling, no serverless hop.
//
// The live data is kept in memory (single source of truth while online),
// mirrored back into the IndexedDB offline catalog (debounced) so the
// offline cache stays fresh, and exposed to the UI through subscribeLive
// + the useLiveCatalog hook.
import store from '../store';
import { getAppConfig } from '../api/config';
import { idbGet, idbPut } from '../offline/indexeddb';
import { catalogKey } from '../offline/offlineStore';

const STREAM_PATHS = ['products', 'product_stock', 'customers', 'stores'];

const live = {
  products: new Map(), // key (string id) -> product row
  stockByKey: new Map(), // 'productId_storeId' -> stock row
  customers: new Map(),
  stores: new Map(),
  ready: false,
  version: 0,
};

const listeners = new Set();
const emit = () => {
  live.version += 1;
  listeners.forEach((fn) => fn());
};
export const subscribeLive = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const isLiveReady = () => live.ready;

let dbUrl = null;
let started = false;
let streams = new Map();
let retryTimer = null;
let backoffMs = 1000;
let idbTimer = null;

const currentStoreId = () => String(store.getState().store.currentStoreId || 1);
const currentToken = () => store.getState().auth.token;

async function ensureDbUrl() {
  if (dbUrl) return dbUrl;
  const cfg = await getAppConfig();
  dbUrl = cfg.databaseURL.replace(/\/+$/, '');
  return dbUrl;
}

// ---- generic tree helpers (RTDB values live in a nested key/value tree) ----

function resetMap(map, data) {
  map.clear();
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) map.set(k, v);
  }
}

// Set `value` at `keyPath` inside a Map-backed tree, creating intermediate
// plain objects as needed. A null value deletes the key.
function setAtPath(root, keyPath, value) {
  if (!keyPath.length) return;
  if (keyPath.length === 1) {
    if (value === null) root.delete(keyPath[0]);
    else root.set(keyPath[0], value);
    return;
  }
  let node = root.get(keyPath[0]);
  if (!node || typeof node !== 'object') {
    node = {};
    root.set(keyPath[0], node);
  }
  let cur = node;
  for (let i = 1; i < keyPath.length - 1; i++) {
    const k = keyPath[i];
    if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  const last = keyPath[keyPath.length - 1];
  if (value === null) delete cur[last];
  else cur[last] = value;
}

// ---- applying stream events to the in-memory snapshot ----

function mapFor(path) {
  return path === 'product_stock' ? live.stockByKey : live[path];
}

function applyStreamEvent(path, evt) {
  const msg = JSON.parse(evt.data);
  const keyPath = String(msg.path || '/')
    .split('/')
    .filter(Boolean);
  const map = mapFor(path);
  if (evt.type === 'put' && keyPath.length === 0) {
    // Full snapshot / node replacement
    resetMap(map, msg.data);
    if (path === 'products') live.ready = true;
    return;
  }
  if (keyPath.length === 0) {
    // Multi-key "patch": data is a map of child-key -> value (null = delete)
    if (msg.data && typeof msg.data === 'object') {
      for (const [k, v] of Object.entries(msg.data)) {
        setAtPath(map, k.split('/').filter(Boolean), v);
        if (path === 'products') live.ready = true;
      }
    }
    return;
  }
  // Single-key "put"/"patch": the value at keyPath is now msg.data
  setAtPath(map, keyPath, msg.data);
  if (path === 'products') live.ready = true;
}

// ---- stream lifecycle ----

function openStream(path) {
  const token = currentToken();
  if (!token || streams.has(path)) return;
  const url = `${dbUrl}/${path}.json?auth=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  streams.set(path, es);
  es.addEventListener('put', (e) => {
    try {
      applyStreamEvent(path, e);
      afterChange();
    } catch {
      /* malformed event: ignore */
    }
  });
  es.addEventListener('patch', (e) => {
    try {
      applyStreamEvent(path, e);
      afterChange();
    } catch {
      /* ignore */
    }
  });
  es.addEventListener('error', () => {
    es.close();
    if (streams.get(path) === es) streams.delete(path);
    scheduleReconnect();
  });
}

function closeAll() {
  for (const es of streams.values()) es.close();
  streams.clear();
  clearTimeout(retryTimer);
  retryTimer = null;
  backoffMs = 1000;
}

function startStreams() {
  if (!dbUrl || !currentToken()) return;
  for (const p of STREAM_PATHS) openStream(p);
}

function scheduleReconnect() {
  if (retryTimer || !currentToken()) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (currentToken()) {
      startStreams();
      backoffMs = Math.min(backoffMs * 2, 30000);
    }
  }, backoffMs);
}

function afterChange() {
  emit();
  scheduleIdbWrite();
}

// Keep the offline catalog fresh with the live snapshot (debounced).
function scheduleIdbWrite() {
  clearTimeout(idbTimer);
  idbTimer = setTimeout(writeSnapshot, 800);
}

async function writeSnapshot() {
  if (!currentToken()) return;
  try {
    await idbPut('catalog', {
      key: catalogKey(),
      products: joinedProducts(),
      customers: getLiveCustomers(),
      store: getLiveStore(),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    /* offline / quota: offlineStore refresh will fix it later */
  }
}

// ---- public live read helpers (filtered for the current store) ----

export function joinedProducts() {
  const sid = currentStoreId();
  const byKey = live.stockByKey;
  const byProduct = new Map();
  for (const [key, row] of byKey) {
    if (String(row.store_id) !== sid) continue;
    byProduct.set(String(row.product_id), row);
  }
  const out = [];
  for (const [key, p] of live.products) {
    const s = byProduct.get(String(key));
    out.push({
      ...p,
      id: Number(key),
      stock_qty: s ? Number(s.stock_qty) || 0 : 0,
      reorder_level: s ? Number(s.reorder_level) || 0 : 0,
    });
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}

export function liveSearch(query) {
  const needle = String(query || '').toLowerCase().trim();
  if (!needle) return [];
  return joinedProducts().filter(
    (p) =>
      (p.name || '').toLowerCase().includes(needle) ||
      (p.sku || '').toLowerCase().includes(needle) ||
      (p.barcode || '').toLowerCase().includes(needle)
  );
}

export function liveByBarcode(code) {
  const needle = String(code || '');
  if (!needle) return null;
  return (
    joinedProducts().find((p) => p.barcode === needle || p.sku === needle) || null
  );
}

export function getLiveProduct(id) {
  const p = live.products.get(String(id));
  if (!p) return null;
  const s = live.stockByKey.get(`${String(id)}_${currentStoreId()}`);
  return {
    ...p,
    id: Number(id),
    stock_qty: s ? Number(s.stock_qty) || 0 : 0,
    reorder_level: s ? Number(s.reorder_level) || 0 : 0,
  };
}

export function getLiveCustomers() {
  return [...live.customers.entries()]
    .map(([key, c]) => ({ id: Number(key), name: c.name, phone: c.phone, email: c.email }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function getLiveStore() {
  return live.stores.get(currentStoreId()) || null;
}

// ---- bootstrap ----

async function seedFromCache() {
  try {
    const cat = await idbGet('catalog', catalogKey());
    if (!cat) return;
    for (const p of cat.products || []) {
      const pid = Number(p.id);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      live.products.set(String(pid), p);
    }
    for (const p of cat.products || []) {
      const pid = Number(p.id);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      live.stockByKey.set(`${pid}_${currentStoreId()}`, {
        product_id: pid,
        store_id: Number(currentStoreId()),
        stock_qty: Number(p.stock_qty) || 0,
        reorder_level: Number(p.reorder_level) || 0,
      });
    }
    for (const c of cat.customers || []) {
      const cid = Number(c.id);
      if (!Number.isInteger(cid) || cid <= 0) continue;
      live.customers.set(String(cid), c);
    }
    if (cat.store && Number.isInteger(Number(cat.store.id))) {
      live.stores.set(String(cat.store.id), cat.store);
    }
  } catch {
    /* first run: nothing cached yet */
  }
}

export async function startRealtime() {
  if (started) return;
  started = true;
  try {
    await ensureDbUrl();
  } catch {
    started = false;
    setTimeout(() => {
      started = false;
      startRealtime();
    }, 5000);
    return;
  }
  await seedFromCache();
  startStreams();
  window.addEventListener('online', restartAll);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restartAll();
  });
}

function restartAll() {
  closeAll();
  startStreams();
}

// Stop/restart streams when the user logs in or out (token changes).
let lastToken = null;
store.subscribe(() => {
  const t = currentToken();
  if (t === lastToken) return;
  lastToken = t;
  if (t) {
    restartAll();
  } else {
    closeAll();
    live.ready = false;
  }
});