// Firebase Auth helpers (REST, web API key) plus ID token verification
// against Google's published certificate metadata.
const crypto = require('crypto');
const config = require('../config');

const AUTH_API = 'https://identitytoolkit.googleapis.com/v1';
const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// The RTDB rules require a Firebase ID token on every request, so requests
// that arrive without one (login attempts, first-run bootstrap) fall back to
// a server-held admin token, refreshed automatically before it expires.
const ADMIN_PASSWORD = 'admin123';
const adminEmail = () => `admin@${config.firebase.authDomain}`;
let serverToken = null;
let serverTokenExp = 0;

async function ensureServerToken() {
  if (serverToken && Date.now() < serverTokenExp - 60000) return serverToken;
  let rec;
  try {
    rec = await signInWithPassword(adminEmail(), ADMIN_PASSWORD);
  } catch (e) {
    if (e.code === 'EMAIL_NOT_FOUND' || e.code === 'INVALID_LOGIN_CREDENTIALS') {
      rec = await createUser(adminEmail(), ADMIN_PASSWORD);
    } else {
      throw e;
    }
  }
  serverToken = rec.idToken;
  serverTokenExp = Date.now() + Number(rec.expiresIn || 3600) * 1000;
  return serverToken;
}

async function authRequest(path, body) {
  const res = await fetch(`${AUTH_API}/${path}?key=${config.firebase.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error ? data.error.message : `Firebase Auth error (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = data.error && data.error.code;
    throw err;
  }
  return data;
}

async function signInWithPassword(email, password) {
  return authRequest('accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true,
  });
}

async function createUser(email, password) {
  return authRequest('accounts:signUp', {
    email,
    password,
    returnSecureToken: true,
  });
}

// Exchange a long-lived refresh token for a fresh ID token (Firebase's
// securetoken endpoint). Returns { id_token, refresh_token, expires_in }.
async function refreshIdToken(refreshToken) {
  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${config.firebase.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error ? data.error.message : `Token refresh failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = data.error && data.error.code;
    throw err;
  }
  return data;
}

let certsCache = { at: 0, certs: {} };

async function getCerts(force) {
  if (!force && certsCache.certs && Date.now() - certsCache.at < 6 * 60 * 60 * 1000) {
    return certsCache.certs;
  }
  const res = await fetch(CERT_URL, { headers: { 'Cache-Control': 'max-age=21600' } });
  const certs = await res.json();
  certsCache = { at: Date.now(), certs };
  return certs;
}

// Verify a Firebase ID token (RS256) and return its payload, or null.
async function verifyFirebaseToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSec) return null;
  if (payload.aud !== config.firebase.projectId) return null;
  if (payload.iss !== `https://securetoken.google.com/${config.firebase.projectId}`) return null;
  let certs = await getCerts(false);
  let cert = certs[header.kid];
  if (!cert) {
    certs = await getCerts(true);
    cert = certs[header.kid];
  }
  if (!cert) return null;
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    if (!verifier.verify(cert, Buffer.from(parts[2], 'base64url'))) return null;
  } catch (e) {
    return null;
  }
  return payload;
}

module.exports = { signInWithPassword, createUser, refreshIdToken, verifyFirebaseToken, ensureServerToken };
