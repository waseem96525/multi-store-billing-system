import api from './client';

export const listTransfers = () => api.get('/transfers').then((r) => r.data);
export const createTransfer = (data) => api.post('/transfers', data).then((r) => r.data);
