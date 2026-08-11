import api from './client';

export const login = (username, password) =>
  api.post('/auth/login', { username, password }).then((r) => r.data);
export const register = (data) => api.post('/auth/register', data).then((r) => r.data);
export const listUsers = () => api.get('/auth/users').then((r) => r.data);
export const setUserActive = (id, body) =>
  api.patch(`/auth/users/${id}`, body).then((r) => r.data);
