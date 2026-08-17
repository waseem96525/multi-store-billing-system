import api from './client';

export const importProducts = (rows, stockMode) =>
  api.post('/import/products', { rows, stock_mode: stockMode }).then((r) => r.data);
