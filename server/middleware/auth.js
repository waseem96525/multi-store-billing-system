const { verifyFirebaseToken } = require('../utils/auth');
const db = require('../db');
const { storage } = require('../fb/context');

// Authenticate a Firebase ID token and load the matching app user record.
// The raw token is stashed in the request's AsyncLocalStorage context so
// every Firebase RTDB call made while handling this request is authorized.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    await db.ready;
    // The token must be in the request's context for the whole request:
    // the security rules reject unauthenticated access, and the context
    // (AsyncLocalStorage) only propagates to code run inside this callback,
    // so next() must be called here rather than after storage.run returns.
    await storage.run(token, async () => {
      const payload = await verifyFirebaseToken(token);
      if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
      const uid = payload.uid || payload.sub || payload.user_id;
      const user = await db.get('users', uid);
      if (!user || !user.active) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }
      req.user = {
        id: user.id,
        name: user.name,
        username: user.username || null,
        email: user.email || null,
        role: user.role || 'cashier',
        store_id: user.store_id || 1,
      };
      next();
    });
  } catch (e) {
    next(e);
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
