import api from './client';

export const adjustStock = (data) => api.post('/stock/adjust', data).then((r) => r.data);
export const listAdjustments = (params) => api.get('/stock', { params }).then((r) => r.data);
