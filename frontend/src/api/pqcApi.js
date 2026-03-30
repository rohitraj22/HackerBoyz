import api from './axios';

export const pqcApi = {
  getOverview(scanId = 'latest') {
    return api.get(`/api/pqc/overview?scanId=${encodeURIComponent(scanId)}`);
  },
  listAssets(grade = '') {
    const suffix = grade ? `?grade=${encodeURIComponent(grade)}` : '';
    return api.get(`/api/pqc/assets${suffix}`);
  },
};
