import api from './axios';

export const scanApi = {
  runScan(payload) {
    return api.post('/api/scans/run', payload);
  },
  getScans() {
    return api.get('/api/scans');
  },
  getScanById(id) {
    return api.get(`/api/scans/${id}`);
  },
  deleteScan(id) {
    return api.delete(`/api/scans/${id}`);
  },
  getHistory(params = {}) {
    return api.get('/api/history', { params });
  },
  getCBOM(id) {
    return api.get(`/api/${id}/cbom`);
  },
  getReport(id) {
    return api.get(`/api/${id}/report`);
  },
  regenerateRecommendation(scanId) {
    return api.post(`/api/recommendations/${scanId}/regenerate`);
  }
};
