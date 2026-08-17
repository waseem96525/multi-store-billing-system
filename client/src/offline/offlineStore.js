// Offline engine: caches the product catalog / customers in IndexedDB and
// queues invoices (and parked bills) created while the network is down.
// When the connection returns it replays the queue and refreshes the cache.
import store from '../store';
import { idbGet, idbGetAll, idbPut, idbDelete } from './indexeddb';
import { listProducts } from '../api/products';
import { listCustomers } from '../api/customers';
import { createInvoice, holdInvoice, listHeldInvoices, deleteHeldInvoice, retrieveHeldInvoice } from '../api/invoices';
import { getCurrentStore } from '../api/stores';

const catalogKey = () => `catalog_${store.getState().store.currentStoreId || 1}`;

const subscribers = new Set();
export const subscribeOffline = (fn) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};
const emit = () => subscribers.forEach((fn) => fn());

export const isOnline = () => navigator.onLine;

// ---- Catalog cache (products + customers + store, per current store) ----

export async function getCatalog() {
  return idbGet('catalog', catalogKey());
}

// Pull the latest products / customers / store into IndexedDB. Safe to call
// repeatedly; silently no-ops when offline.
export async function refreshCatalog() {
  try {
    const [{ products }, { customers }, { store: shop }] = await Promise.all([
      listProducts({}),
      listCustomers(),
      getCurrentStore(),
    ]);
    await idbPut('catalog', {
      key: catalogKey(),
      products: products || [],
      customers: customers || [],
      store: shop || null,
      updatedAt: new Date().toISOString(),
    });
    emit();
    return { products: products || [], customers: customers || [], store: shop || null };
  } catch {
    return null;
  }
}

export async function searchCachedProducts(query) {
  const cat = await getCatalog();
  if (!cat || !cat.products) return [];
  const needle = String(query || '').toLowerCase().trim();
  if (!needle) return [];
  return cat.products.filter(
    (p) =>
      (p.name || '').toLowerCase().includes(needle) ||
      (p.sku || '').toLowerCase().includes(needle) ||
      (p.barcode || '').toLowerCase().includes(needle)
  );
}

export async function findCachedProductByCode(code) {
  const needle = String(code || '');
  if (!needle) return null;
  const cat = await getCatalog();
  if (!cat || !cat.products) return null;
  return (
    cat.products.find((p) => p.barcode === needle || p.sku === needle) || null
  );
}

export async function frequentFromCache(limit = 12) {
  const cat = await getCatalog();
  if (!cat || !cat.products) return [];
  return [...cat.products]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

export async function getCachedCustomers() {
  const cat = await getCatalog();
  return cat && cat.customers ? cat.customers : [];
}

// ---- Pending invoices (created while offline) ----

export async function enqueueInvoice(payload, receipt) {
  const id = await idbPut('pending_invoices', {
    payload,
    receipt,
    localInvoiceNo: receipt.invoice.invoice_no,
    created_at: new Date().toISOString(),
    status: 'pending',
    error: null,
  });
  emit();
  return id;
}

export async function getPendingCount() {
  const rows = await idbGetAll('pending_invoices');
  return rows.length;
}

export async function listPending() {
  return idbGetAll('pending_invoices');
}

// Apply an offline sale to the cached stock so the next offline charge
// validates against the reduced quantity.
export async function applyOfflineSale(payload) {
  const cat = await getCatalog();
  if (!cat || !cat.products) return;
  const agg = {};
  for (const it of payload.items || []) {
    agg[it.product_id] = (agg[it.product_id] || 0) + (Number(it.qty) || 0);
  }
  cat.products = cat.products.map((p) =>
    agg[p.id] ? { ...p, stock_qty: Math.max(0, (Number(p.stock_qty) || 0) - agg[p.id]) } : p
  );
  await idbPut('catalog', cat);
  emit();
}

// Replay queued invoices against the server. Failed entries stay queued with
// a readable error so the store can fix stock and retry.
export async function syncPending() {
  const pending = await idbGetAll('pending_invoices');
  const synced = [];
  const failed = [];
  for (const item of pending) {
    try {
      const res = await createInvoice(item.payload);
      await idbDelete('pending_invoices', item.id);
      synced.push({ localInvoiceNo: item.localInvoiceNo, invoiceNo: res.invoice.invoiceNo });
    } catch (e) {
      const error = e.response?.data?.error || e.message || 'Sync failed';
      await idbPut('pending_invoices', { ...item, status: 'failed', error });
      failed.push({ localInvoiceNo: item.localInvoiceNo, error });
    }
  }
  if (pending.length) emit();
  return { synced, failed };
}

// ---- Parked bills: always stored locally, mirrored to the server when online ----

export async function parkHeld(payload, label) {
  let serverId = null;
  if (isOnline()) {
    try {
      const res = await holdInvoice({ payload, label });
      serverId = res.heldBill.id;
    } catch {
      /* keep local only */
    }
  }
  const created_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const id = await idbPut('held_bills', { payload, label, created_at, server_id: serverId });
  emit();
  return { id, payload, label, created_at, server_id: serverId };
}

export async function listHeld() {
  const local = await idbGetAll('held_bills');
  local.sort((a, b) => b.id - a.id);
  if (!isOnline()) return local;
  try {
    const { heldBills } = await listHeldInvoices();
    const serverById = new Map(heldBills.map((h) => [h.id, h]));
    // Merge: prefer the local copy (has the original payload + label).
    const seen = new Set();
    const merged = [];
    for (const l of local) {
      merged.push(l);
      if (l.server_id != null) seen.add(l.server_id);
    }
    for (const h of heldBills) {
      if (!seen.has(h.id)) merged.push({ ...h, id: h.id, server_id: h.id, local_only: false });
    }
    merged.sort((a, b) => b.id - a.id);
    return merged;
  } catch {
    return local;
  }
}

export async function retrieveHeld(id) {
  const local = await idbGet('held_bills', id);
  if (local) {
    if (local.server_id != null && isOnline()) {
      try {
        await deleteHeldInvoice(local.server_id);
      } catch {
        /* ignore */
      }
    }
    await idbDelete('held_bills', id);
    emit();
    return { heldBill: { id: local.id, payload: local.payload, label: local.label } };
  }
  if (isOnline()) {
    const res = await retrieveHeldInvoice(id);
    await deleteHeldInvoice(id);
    return res;
  }
  throw new Error('Parked bill not found');
}

export async function deleteHeld(id) {
  const local = await idbGet('held_bills', id);
  if (local && local.server_id != null && isOnline()) {
    try {
      await deleteHeldInvoice(local.server_id);
    } catch {
      /* ignore */
    }
  }
  await idbDelete('held_bills', id);
  emit();
}

// ---- Online/offline listeners ----

let started = false;
export function startOfflineEngine() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    emit();
    refreshCatalog();
    syncPending();
  });
  window.addEventListener('offline', () => emit());
}