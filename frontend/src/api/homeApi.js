import api from './axios';

export const homeApi = {
  getSummary() {
    return api.get('/api/home/summary');
  },
};
