// Resolve the store the request operates on.
// Admins may override via the X-Store-Id header (store switcher in the UI);
// everyone else is always scoped to their own store.
const getStoreId = (req) => {
  const header = req.headers['x-store-id'];
  if (req.user && req.user.role === 'admin' && header && /^\d+$/.test(header)) {
    return parseInt(header, 10);
  }
  return req.user && req.user.store_id ? req.user.store_id : 1;
};

const attachStore = (req, res, next) => {
  req.storeId = getStoreId(req);
  next();
};

module.exports = { getStoreId, attachStore };
