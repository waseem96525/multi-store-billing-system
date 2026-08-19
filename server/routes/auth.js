const express = require('express');
const db = require('../db');
const { signInWithPassword, createUser, refreshIdToken, verifyFirebaseToken, ensureServerToken } = require('../utils/auth');
const { storage } = require('../fb/context');
const { authenticate, authorize } = require('../middleware/auth');
const { ALL_ROLES } = require('../utils/permissions');
const { logActivity } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Sign in with Firebase Auth. Accepts an email or a username (the username
// is resolved to the stored email first).
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Email/username and password required' });
  }
  let email = String(username).trim();
  if (!email.includes('@')) {
    // Reads before authentication use the server-held admin token
    const token = await ensureServerToken();
    const users = await storage.run(token, () => db.all('users'));
    const found = users.find(
      (u) => (u.username || '').toLowerCase() === email.toLowerCase()
    );
    if (!found || !found.email) return res.status(401).json({ error: 'Invalid credentials' });
    email = found.email;
  }
  let rec;
  try {
    rec = await signInWithPassword(email, password);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  return storage.run(rec.idToken, async () => {
    const user = await db.get('users', rec.localId);
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });
    logActivity(user, 'login', `${user.name} signed in`, user.store_id);
    res.json({
      token: rec.idToken,
      refreshToken: rec.refreshToken || null,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        store_id: user.store_id,
      },
    });
  });
}));

// Exchange a refresh token for a fresh ID token. Fire and forget: no
// activity log, no user lookup - the ID token carries the identity.
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  let rec;
  try {
    rec = await refreshIdToken(refreshToken);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  const payload = await verifyFirebaseToken(rec.id_token);
  if (!payload) return res.status(401).json({ error: 'Invalid refresh token' });
  res.json({ token: rec.id_token, expiresIn: Number(rec.expires_in || 3600) });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await db.get('users', req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const store = user.store_id ? await db.get('stores', user.store_id) : null;
  res.json({ user: { ...user, store_name: store ? store.name : null } });
}));

router.post('/register', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { name, username, email, password, role, store_id } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, password required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const userRole = ALL_ROLES.includes(role) ? role : 'cashier';
  const userStoreId = Number(store_id) || req.user.store_id || 1;
  const store = await db.get('stores', userStoreId);
  if (!store) return res.status(400).json({ error: 'Invalid store' });
  const users = await db.all('users');
  if (users.some((u) => (u.email || '').toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already exists' });
  }
  let rec;
  try {
    rec = await createUser(email, password);
  } catch (e) {
    if (e.code === 'EMAIL_EXISTS') return res.status(409).json({ error: 'Email already exists' });
    return res.status(400).json({ error: e.message });
  }
  const user = {
    id: rec.localId,
    name,
    username: username || null,
    email,
    role: userRole,
    active: 1,
    store_id: userStoreId,
    created_at: db.now(),
  };
  await db.set('users', rec.localId, user);
  logActivity(req.user, 'user_created', `Created user "${name}" (${userRole})`, req.storeId);
  res.status(201).json({ id: rec.localId, name, username: user.username, email, role: userRole, store_id: userStoreId });
}));

router.get('/users', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const [users, stores] = await Promise.all([db.all('users'), db.all('stores')]);
  const storeMap = Object.fromEntries(stores.map((s) => [s.id, s]));
  res.json({
    users: users.map((u) => ({
      ...u,
      store_name: u.store_id && storeMap[u.store_id] ? storeMap[u.store_id].name : null,
    })),
  });
}));

router.patch('/users/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { active, store_id } = req.body || {};
  const patch = {};
  if (active !== undefined) patch.active = active ? 1 : 0;
  if (store_id !== undefined) {
    const store = await db.get('stores', Number(store_id));
    if (!store) return res.status(400).json({ error: 'Invalid store' });
    patch.store_id = Number(store_id);
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  const existing = await db.get('users', req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  await db.update('users', req.params.id, patch);
  logActivity(req.user, 'user_updated', `Updated user ${existing.name}`, req.storeId);
  res.json({ success: true });
}));

module.exports = router;
