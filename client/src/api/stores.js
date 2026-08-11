import api from './client';

export const listStores = () => api.get('/stores').then((r) => r.data);
export const getCurrentStore = () => api.get('/stores/current').then((r) => r.data);
export const createStore = (data) => api.post('/stores', data).then((r) => r.data);
export const updateCurrentStore = (data) =>
  api.put('/stores/current', data).then((r) => r.data);
export const updateStore = (id, data) => api.put(`/stores/${id}`, data).then((r) => r.data);
