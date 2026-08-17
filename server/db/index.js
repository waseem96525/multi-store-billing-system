// Firebase backend facade. Previously this file created the local SQLite
// database; it now bootstraps the Firebase Realtime Database (default store
// and admin user) and re-exports the repository helpers used by the routes.
//
// The RTDB rules require a valid Firebase ID token on every request, so the
// bootstrap authenticates as the default admin first (creating the Auth
// account on the very first run) and runs all seeding inside that token's
// context. It also repairs the situation where the Auth account was deleted
// or recreated but the old user record is still in the database.
const db = require('../fb/db');
const { storage } = require('../fb/context');
const config = require('../config');
const { ensureServerToken } = require('../utils/auth');

async function bootstrap() {
  let token;
  try {
    token = await ensureServerToken();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Admin auth setup failed:', e.message);
    return;
  }
  try {
    await storage.run(token, async () => {
      // Seed the default store on a brand-new database
      let stores = await db.all('stores');
      if (!stores.length) {
        const store = await db.insert('stores', {
          name: 'Main Store',
          address: null,
          phone: null,
          gstin: null,
          receipt_footer: null,
          created_at: db.now(),
        });
        stores = [store];
        // eslint-disable-next-line no-console
        console.log('Seeded default store: Main Store');
      }

      // Ensure the admin user record exists for the current Auth account
      const uid = token.split('.')[1]
        ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub
        : null;
      const existing = uid ? await db.get('users', uid) : null;
      if (!existing) {
        const users = await db.all('users');
        await db.set('users', uid, {
          id: uid,
          name: 'Admin',
          username: 'admin',
          email: `admin@${config.firebase.authDomain}`,
          role: 'admin',
          active: 1,
          store_id: stores[0].id,
          created_at: db.now(),
        });
        // eslint-disable-next-line no-console
        console.log(
          users.length
            ? `Repaired admin user record -> uid: ${uid}`
            : 'Seeded default admin -> email: admin@<authDomain>  password: admin123'
        );
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Firebase bootstrap failed:', e.message);
  }
}

// Never rejects - routes await this to ensure the seed has (tried to) run.
const ready = Promise.resolve().then(() => bootstrap());

module.exports = { ...db, ready };