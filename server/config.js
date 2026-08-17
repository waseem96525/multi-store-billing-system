require('dotenv').config();

module.exports = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiry: process.env.JWT_EXPIRY || '12h',
  // Firebase configuration. The web API key is only used to reach the
  // Firebase Auth REST API; data access uses the logged-in user's ID token.
  firebase: {
    apiKey:
      process.env.FIREBASE_API_KEY || 'AIzaSyCBi6GCigBZx5yRTTTW8SXHzSkA1uTAvpM',
    authDomain:
      process.env.FIREBASE_AUTH_DOMAIN || 'billingsol-e9a83.firebaseapp.com',
    databaseURL:
      process.env.FIREBASE_DATABASE_URL ||
      'https://billingsol-e9a83-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: process.env.FIREBASE_PROJECT_ID || 'billingsol-e9a83',
  },
};
