const express = require('express');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Public-safe app config needed by the client for direct Firebase
// Realtime Database streaming (product/stock live sync). The database
// still requires a valid Firebase ID token for every read/write.
router.get('/', authenticate, (req, res) => {
  res.json({
    databaseURL: config.firebase.databaseURL,
    authDomain: config.firebase.authDomain,
  });
});

module.exports = router;