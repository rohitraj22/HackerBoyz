import api from './axios';

export const cbomApi = {
  getLatest(refresh = false) {
    return api.get(`/api/cbom/latest${refresh ? '?refresh=true' : ''}`);
  },
  getByScan(scanId) {
    return api.get(`/api/cbom/${scanId}`);
  },
  rebuild(scanId) {
    return api.post(`/api/cbom/${scanId}/rebuild`);
  },
};
