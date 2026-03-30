import api from './axios';

export const ratingApi = {
  getEnterprise(scanId = 'latest') {
    return api.get(`/api/rating/enterprise?scanId=${encodeURIComponent(scanId)}`);
  },
  listAssets() {
    return api.get('/api/rating/assets');
  },
  recalculate(scanId = '') {
    const target = String(scanId || '').trim();
    if (!target || target.toLowerCase() === 'latest') {
      return api.post('/api/rating/recalculate');
    }
    return api.post(`/api/rating/recalculate/${encodeURIComponent(target)}`);
  },
};
