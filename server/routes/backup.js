const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');

const router = express.Router();

router.use(authenticate, attachStore);

// Download a consistent snapshot of the whole database (admin only).
// Uses VACUUM INTO so the backup is a single valid SQLite file even in WAL mode.
router.get('/', authorize('admin'), (req, res) => {
  if (process.env.TURSO_URL) {
    return res.status(400).json({
      error: 'Backup is only available when running with a local database file (not on the hosted Vercel/Turso deployment)',
    });
  }
  const tmpFile = path.join(os.tmpdir(), `retail-pos-backup-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${tmpFile.replace(/'/g, "''")}'`);
    res.download(tmpFile, `retail-pos-backup-${new Date().toISOString().slice(0, 10)}.db`, (err) => {
      fs.unlink(tmpFile, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Backup download failed' });
      }
    });
  } catch (e) {
    try { fs.unlink(tmpFile, () => {}); } catch (e2) {}
    res.status(500).json({ error: 'Could not create backup: ' + e.message });
  }
});

module.exports = router;
