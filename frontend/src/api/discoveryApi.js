import api from './axios';

export const discoveryApi = {
  getGraph(scanId = 'latest') {
    return api.get(`/api/discovery/graph?scanId=${encodeURIComponent(scanId)}`);
  },
  search(payload) {
    return api.post('/api/discovery/search', payload);
  },
  run(payload) {
    return api.post('/api/discovery/run', payload);
  },
  getRelatedAssets(id) {
    return api.get(`/api/discovery/asset/${id}/related`);
  },
};
