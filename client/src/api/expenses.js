import api from './client';

export const listExpenses = (params) => api.get('/expenses', { params }).then((r) => r.data);
export const createExpense = (data) => api.post('/expenses', data).then((r) => r.data);
export const deleteExpense = (id) => api.delete(`/expenses/${id}`).then((r) => r.data);
