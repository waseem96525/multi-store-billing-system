import api from './client';

export const createInvoice = (data) => api.post('/invoices', data).then((r) => r.data);
export const getInvoice = (id) => api.get(`/invoices/${id}`).then((r) => r.data);
export const listInvoices = (params) =>
  api.get('/invoices', { params }).then((r) => r.data);
export const holdInvoice = (data) => api.post('/invoices/hold', data).then((r) => r.data);
export const listHeldInvoices = () => api.get('/invoices/held').then((r) => r.data);
export const retrieveHeldInvoice = (id) =>
  api.post(`/invoices/retrieve/${id}`).then((r) => r.data);
export const deleteHeldInvoice = (id) =>
  api.delete(`/invoices/held/${id}`).then((r) => r.data);
export const voidInvoice = (id, reason) =>
  api.post(`/invoices/${id}/void`, { reason }).then((r) => r.data);
export const editInvoice = (id, data) => api.put(`/invoices/${id}`, data).then((r) => r.data);
