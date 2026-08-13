const db = require('../db');

// Record an audit log entry. Never throws - logging must not break the
// request flow if the write fails.
function logActivity(user, action, details, storeId) {
  try {
    db.prepare(
      'INSERT INTO activity_logs (user_id, action, details, store_id) VALUES (?,?,?,?)'
    ).run(user && user.id ? user.id : null, action, details || null, storeId || (user && user.store_id) || null);
  } catch (e) {
    // ignore
  }
}

module.exports = { logActivity };
