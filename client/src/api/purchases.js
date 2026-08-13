import api from './client';

export const listPurchases = () => api.get('/purchases').then((r) => r.data);
export const createPurchase = (data) => api.post('/purchases', data).then((r) => r.data);
export const getPurchase = (id) => api.get(`/purchases/${id}`).then((r) => r.data);
export const getPurchaseSuggestions = () => api.get('/purchases/suggestions').then((r) => r.data);
