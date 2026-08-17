const { storage } = require('./fb/context');
const { ensureServerToken } = require('./utils/auth');
const db = require('./fb/db');

(async () => {
  const token = await ensureServerToken();
  await storage.run(token, async () => {
    const products = await db.all('products');
    for (const p of products) {
      console.log(`id=${p.id} (${typeof p.id}) name=${p.name}`);
    }
    const ids = products.map((p) => p.id);
    const ok = ids.every((id) => typeof id === 'number');
    console.log('all numeric ids:', ok);
    const want = [18];
    const found = products.filter((p) => want.includes(p.id));
    console.log('products.find(18):', found.length === 1 ? found[0].name : 'MISSING');
    const users = await db.all('users');
    for (const u of users) console.log(`user id=${u.id} (${typeof u.id}) role=${u.role}`);
  });
})();