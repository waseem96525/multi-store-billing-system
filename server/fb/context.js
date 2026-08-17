// Per-request storage. The authenticated Firebase ID token is stashed here
// by the auth middleware so the Firebase REST client can attach it to every
// RTDB call without threading it through every function signature.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

const tokenStore = () => storage.getStore();

module.exports = { storage, tokenStore };
