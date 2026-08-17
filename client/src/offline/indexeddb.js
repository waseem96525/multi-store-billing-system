// Minimal promise-based IndexedDB wrapper used by the offline module.
const DB_NAME = 'retail-pos-offline';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('catalog')) {
          db.createObjectStore('catalog', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('pending_invoices')) {
          db.createObjectStore('pending_invoices', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('held_bills')) {
          db.createObjectStore('held_bills', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        try {
          result = fn(s);
        } catch (e) {
          t.abort();
          reject(e);
          return;
        }
        if (result && typeof result.onsuccess === 'function') {
          result.onsuccess = () => resolve(result.result);
          result.onerror = () => reject(result.error);
        } else {
          t.oncomplete = () => resolve(result);
        }
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export const idbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const idbGetAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const idbPut = (store, value) => tx(store, 'readwrite', (s) => s.put(value));
export const idbDelete = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));