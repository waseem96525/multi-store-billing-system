import axios from 'axios';
import store from '../store';

const api = axios.create({ baseURL: '/api' });

// ---- Firebase ID token refresh ----
// ID tokens expire after ~1 hour; the long-lived refresh token (returned at
// login and stored in the auth slice) is exchanged for a fresh ID token.
// A single in-flight refresh is shared by all concurrent 401 retries.
let refreshPromise = null;
let refreshTimer = null;

function getRefreshToken() {
  return store.getState().auth.refreshToken;
}

function getToken() {
  return store.getState().auth.token;
}

function tokenExpiresIn(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 - Date.now() : 0;
  } catch {
    return 0;
  }
}

async function tryRefresh() {
  if (!getRefreshToken()) return null;
  if (!refreshPromise) {
    refreshPromise = axios
      .post('/api/auth/refresh', { refreshToken: getRefreshToken() })
      .then((r) => r.data.token)
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function applyToken(token) {
  if (token) store.dispatch({ type: 'auth/setToken', payload: { token } });
}

async function refreshNow() {
  const fresh = await tryRefresh();
  if (fresh) {
    applyToken(fresh);
    scheduleTokenRefresh();
  } else if (!navigator.onLine) {
    refreshTimer = setTimeout(refreshNow, 60000); // offline: retry later
  } else {
    store.dispatch({ type: 'auth/logout' });
  }
}

// When connectivity returns, re-arm the pre-expiry refresh immediately.
window.addEventListener('online', scheduleTokenRefresh);

// Refresh a few minutes before the ID token expires so long-lived sessions
// (and the realtime SSE streams) never see a 401. Expired-but-restored
// sessions refresh right away instead of waiting for the first 401.
function scheduleTokenRefresh() {
  clearTimeout(refreshTimer);
  const token = getToken();
  if (!token || !getRefreshToken()) return;
  const ms = tokenExpiresIn(token) - 5 * 60 * 1000;
  refreshTimer = setTimeout(refreshNow, ms > 0 ? ms : 100);
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const storeId = store.getState().store.currentStoreId;
  if (storeId) config.headers['X-Store-Id'] = String(storeId);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;
    if (response && response.status === 401 && !config._retried && config.url !== '/auth/login') {
      const fresh = await tryRefresh();
      if (fresh) {
        applyToken(fresh);
        scheduleTokenRefresh();
        config._retried = true;
        config.headers.Authorization = `Bearer ${fresh}`;
        return api.request(config);
      }
    }
    if (response && response.status === 401 && config && config.url !== '/auth/login') {
      store.dispatch({ type: 'auth/logout' });
    }
    return Promise.reject(error);
  }
);

// Re-arm the pre-expiry refresh whenever the token changes (login, restore,
// refresh, logout).
let lastToken = null;
store.subscribe(() => {
  const t = getToken();
  if (t === lastToken) return;
  lastToken = t;
  if (t) scheduleTokenRefresh();
  else clearTimeout(refreshTimer);
});

// A session restored from localStorage never dispatches, so arm once here.
scheduleTokenRefresh();

export default api;