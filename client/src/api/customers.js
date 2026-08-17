import api from './client';

export const listCustomers = () => api.get('/customers').then((r) => r.data);
export const createCustomer = (data) => api.post('/customers', data).then((r) => r.data);
export const updateCustomer = (id, data) => api.put(`/customers/${id}`, data).then((r) => r.data);
