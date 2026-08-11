import api from './client';

export const listProducts = (params) => api.get('/products', { params }).then((r) => r.data);
export const getProductByBarcode = (code) =>
  api.get(`/products/barcode/${encodeURIComponent(code)}`).then((r) => r.data);
export const listFrequentProducts = (limit = 12) =>
  api.get('/products/frequent', { params: { limit } }).then((r) => r.data);
export const createProduct = (data) => api.post('/products', data).then((r) => r.data);
export const updateProduct = (id, data) => api.put(`/products/${id}`, data).then((r) => r.data);
export const deleteProduct = (id) => api.delete(`/products/${id}`).then((r) => r.data);
export const listCategories = () => api.get('/products/categories/all').then((r) => r.data);
export const createCategory = (name) =>
  api.post('/products/categories', { name }).then((r) => r.data);
export const renameCategory = (id, name) =>
  api.put(`/products/categories/${id}`, { name }).then((r) => r.data);
export const deleteCategory = (id) => api.delete(`/products/categories/${id}`).then((r) => r.data);
