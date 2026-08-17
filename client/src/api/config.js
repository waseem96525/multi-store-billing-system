import api from './client';

export const getAppConfig = () => api.get('/config').then((r) => r.data);