import api from './client';

export const getDashboard = () => api.get('/dashboard').then((r) => r.data);
