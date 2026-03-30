import api from './axios';

export const loginApi = (data) => api.post('/api/auth/login', data, { timeout: 0 });
export const registerApi = (data) => api.post('/api/auth/register', data);
export const logoutApi = () => api.post('/api/auth/logout');
export const getMeApi = () => api.get('/api/auth/me');