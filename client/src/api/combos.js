import api from './client';

export const listCombos = () => api.get('/combos').then((r) => r.data);
export const createCombo = (data) => api.post('/combos', data).then((r) => r.data);
export const updateCombo = (id, data) =>
  api.put(`/combos/${id}`, data).then((r) => r.data);
export const deleteCombo = (id) => api.delete(`/combos/${id}`).then((r) => r.data);
