// Minimal Firebase Realtime Database REST client.
// All calls are authenticated with the request's Firebase ID token
// (attached automatically via AsyncLocalStorage). Nested-path PATCHes
// allow several tables to be written in one round trip, which keeps
// checkouts and bulk imports fast on a hosted database.
//
// Serverless note: the TLS connection to the RTDB (often in a distant
// region, e.g. asia-southeast1) is occasionally reset by the network.
// Transient network failures and 5xx/429 responses are retried with a
// short backoff so a single dropped socket does not 500 the request.
const config = require('../config');
const { tokenStore } = require('./context');

const dbUrl = config.firebase.databaseURL.replace(/\/+$/, '');

const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = [408, 425, 429, 500, 502, 503, 504];

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function attemptRequest(path, { method = 'GET', body, query = {} } = {}) {
  const token = tokenStore();
  const url = new URL(`${dbUrl}/${String(path).replace(/^\/+/, '')}.json`);
  if (token) url.searchParams.set('auth', token);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = text;
    }
  }
  if (!res.ok) {
    const detail =
      data && data.error
        ? typeof data.error === 'string'
          ? data.error
          : data.error.message || JSON.stringify(data.error)
        : `HTTP ${res.status}`;
    throw new HttpError(detail, res.status);
  }
  return data;
}

async function request(path, opts = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptRequest(path, opts);
    } catch (err) {
      const isNetworkError = !(err instanceof HttpError);
      const isRetriableHttp =
        err instanceof HttpError && RETRYABLE_STATUS.includes(err.status);
      if ((!isNetworkError && !isRetriableHttp) || attempt === MAX_ATTEMPTS) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  throw lastErr;
}

module.exports = {
  HttpError,
  get: (path, query) => request(path, { query }),
  set: (path, value) => request(path, { method: 'PUT', body: value }),
  push: (path, value) => request(path, { method: 'POST', body: value }),
  // Single-path update
  patch: (path, value) => request(path, { method: 'PATCH', body: value }),
  // Multi-path update: { 'invoices/5': {...}, 'product_stock/2_1': {...}, ... }
  patchMulti: (paths) => request('/', { method: 'PATCH', body: paths }),
  remove: (path) => request(path, { method: 'DELETE' }),
};
