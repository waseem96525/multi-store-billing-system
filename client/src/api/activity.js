import api from './client';

export const listActivity = (params) => api.get('/activity', { params }).then((r) => r.data);
export const listActivityUsers = () => api.get('/activity/users').then((r) => r.data);
