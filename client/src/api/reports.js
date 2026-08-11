import api from './client';

export const getSummary = (params) => api.get('/reports/summary', { params }).then((r) => r.data);
export const getDaily = (params) => api.get('/reports/daily', { params }).then((r) => r.data);
export const getTopProducts = (params) =>
  api.get('/reports/top-products', { params }).then((r) => r.data);
export const getPaymentModes = (params) =>
  api.get('/reports/payment-modes', { params }).then((r) => r.data);
export const getExpenseBreakdown = (params) =>
  api.get('/reports/expense-breakdown', { params }).then((r) => r.data);
