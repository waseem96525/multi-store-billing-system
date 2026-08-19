// Repository layer over the Firebase Realtime Database.
// Mirrors the old SQL tables as JSON collections with auto-incrementing
// numeric ids (kept in a counters node) so the rest of the app keeps working
// with the same ids, joins and payload shapes.
const client = require('./client');

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const today = () => new Date().toISOString().slice(0, 10);
const dateOf = (ts) => String(ts || '').slice(0, 10);

const T = {
  users: 'users',
  categories: 'categories',
  products: 'products',
  product_stock: 'product_stock',
  invoices: 'invoices',
  invoice_items: 'invoice_items',
  stock_adjustments: 'stock_adjustments',
  suppliers: 'suppliers',
  customers: 'customers',
  purchases: 'purchases',
  purchase_items: 'purchase_items',
  held_bills: 'held_bills',
  stores: 'stores',
  expenses: 'expenses',
  returns: 'returns',
  return_items: 'return_items',
  stock_transfers: 'stock_transfers',
  stock_transfer_items: 'stock_transfer_items',
  activity_logs: 'activity_logs',
  cash_sessions: 'cash_sessions',
};

const stockKey = (productId, storeId) => `${productId}_${storeId}`;

// Allocate one id for a table. Retries guard against concurrent writers
// (several serverless instances / the local server can race on the shared
// counter). If the stored counter has fallen behind the real data (or an id
// is already taken by a concurrent writer), we scan forward to the next free
// id instead of retrying the same occupied id forever.
async function nextId(table) {
  for (let i = 0; i < 12; i++) {
    let cur = Number((await client.get(`meta/counters/${table}`)) || 0);
    let id = cur + 1;
    // Skip over any ids that are already in use (handles stale counters/gaps).
    while (await client.get(`${table}/${id}`)) {
      await client.set(`meta/counters/${table}`, id);
      id += 1;
    }
    await client.set(`meta/counters/${table}`, id);
    if (Number((await client.get(`meta/counters/${table}`))) === id) return id;
  }
  throw new Error(`Could not allocate id for ${table}`);
}

// Allocate n consecutive ids in one round trip (plus a verify read). Scans
// forward past any occupied ids so a stale counter never deadlocks.
async function reserveIds(table, n) {
  if (n <= 0) return [];
  for (let i = 0; i < 12; i++) {
    let cur = Number((await client.get(`meta/counters/${table}`)) || 0);
    let start = cur + 1;
    while (await client.get(`${table}/${start}`)) start += 1;
    const end = start + n - 1;
    await client.set(`meta/counters/${table}`, end);
    if (Number((await client.get(`meta/counters/${table}`))) === end) {
      const ids = [];
      for (let k = start; k <= end; k++) ids.push(k);
      return ids;
    }
  }
  throw new Error(`Could not allocate ids for ${table}`);
}

// Attach the RTDB key as `id`. Rows created by this backend store `id`
// inside the object, but data migrated/seeded externally may rely solely on
// the key - without this, callers (edit/delete by id) break.
// RTDB keys are strings, while the app's business ids are numeric counters;
// normalize numeric-looking ids so joins/comparisons against numeric ids
// (e.g. `ids.includes(p.id)` in purchases) work for legacy rows too. UIDs
// (users table) stay strings.
function toAppId(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number') return v;
  if (/^\d+$/.test(String(v))) return Number(v);
  return v;
}

function withId(key, obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return { ...obj, id: toAppId(obj.id ?? key) };
}

// All rows of a table as an array of objects.
async function all(table, opts = {}) {
  const data = await client.get(table);
  const rows = data && typeof data === 'object'
    ? Object.entries(data).map(([k, v]) => withId(k, v))
    : [];
  const clean = rows.filter((r) => r && typeof r === 'object');
  const by = opts.by || 'id';
  clean.sort((a, b) => (a[by] < b[by] ? -1 : a[by] > b[by] ? 1 : 0));
  if (opts.desc) clean.reverse();
  return clean;
}

async function where(table, predicate) {
  const rows = await all(table);
  return rows.filter(predicate);
}

async function get(table, id) {
  return withId(String(id), await client.get(`${table}/${encodeURIComponent(id)}`));
}

async function set(table, id, obj) {
  return client.set(`${table}/${encodeURIComponent(id)}`, obj);
}

async function insert(table, obj) {
  const id = await nextId(table);
  const row = { id, ...obj };
  await client.set(`${table}/${id}`, row);
  return row;
}

// Insert several rows, allocating all ids in one batch.
async function insertBatch(table, objs) {
  if (!objs.length) return [];
  const ids = await reserveIds(table, objs.length);
  const paths = {};
  const rows = [];
  objs.forEach((obj, i) => {
    const row = { id: ids[i], ...obj };
    paths[`${table}/${ids[i]}`] = row;
    rows.push(row);
  });
  await client.patchMulti(paths);
  return rows;
}

async function update(table, id, patch) {
  await client.patch(`${table}/${encodeURIComponent(id)}`, patch);
  return client.get(`${table}/${encodeURIComponent(id)}`);
}

async function remove(table, id) {
  await client.remove(`${table}/${encodeURIComponent(id)}`);
}

// The whole database as a nested object (used by the backup endpoint).
async function getAll() {
  return client.get('');
}

module.exports = {
  T,
  now,
  today,
  dateOf,
  stockKey,
  nextId,
  reserveIds,
  all,
  where,
  get,
  set,
  insert,
  insertBatch,
  update,
  remove,
  getAll,
  patchMulti: client.patchMulti,
};
