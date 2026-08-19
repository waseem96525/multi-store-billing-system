import api from './client';

export const listReturns = (params) => api.get('/returns', { params }).then((r) => r.data);
export const getReturn = (id) => api.get(`/returns/${id}`).then((r) => r.data);
export const getInvoiceReturnItems = (invoiceId) =>
  api.get(`/returns/invoice/${invoiceId}/items`).then((r) => r.data);
export const createReturn = (data) => api.post('/returns', data).then((r) => r.data);
export const approveReturn = (id) =>
  api.patch(`/returns/${id}/approve`).then((r) => r.data);
export const rejectReturn = (id, reason) =>
  api.patch(`/returns/${id}/reject`, { reason }).then((r) => r.data);
