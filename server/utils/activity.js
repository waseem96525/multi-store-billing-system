const db = require('../fb/db');

// Record an audit log entry. Fire-and-forget: never blocks the request.
function logActivity(user, action, details, storeId) {
  db.insert('activity_logs', {
    user_id: user && user.id ? user.id : null,
    action,
    details: details || null,
    store_id: storeId || (user && user.store_id) || null,
    created_at: db.now(),
  }).catch(() => {});
}

// Allocate an activity log entry and return { key, value } so it can be
// included in a batched multi-path write (keeps transactions atomic).
async function prepareLog(user, action, details, storeId) {
  const id = await db.nextId('activity_logs');
  return {
    key: `activity_logs/${id}`,
    value: {
      id,
      user_id: user && user.id ? user.id : null,
      action,
      details: details || null,
      store_id: storeId || (user && user.store_id) || null,
      created_at: db.now(),
    },
  };
}

module.exports = { logActivity, prepareLog };
