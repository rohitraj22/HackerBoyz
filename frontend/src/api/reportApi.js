import api from './axios';

export const reportApi = {
  getCbom(scanId) {
    return api.get(`/api/${scanId}/cbom`);
  },
  getReport(scanId) {
    return api.get(`/api/${scanId}/report`);
  },
  regenerateRecommendation(scanId) {
    return api.post(`/api/recommendations/${scanId}/regenerate`);
  },
};
