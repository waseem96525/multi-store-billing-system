import api from './client';

export const getCurrentSession = () => api.get('/cash/current').then((r) => r.data);
export const openDrawer = (opening_amount) =>
  api.post('/cash/open', { opening_amount }).then((r) => r.data);
export const closeDrawer = (closing_amount, notes) =>
  api.post('/cash/close', { closing_amount, notes }).then((r) => r.data);
export const listSessions = (params) =>
  api.get('/cash/sessions', { params }).then((r) => r.data);
export const getSessionReport = (id) =>
  api.get(`/cash/report/${id}`).then((r) => r.data);