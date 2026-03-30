import api from './axios';

export const inventoryApi = {
  getSummary() {
    return api.get('/api/inventory/summary');
  },
  listAssets(params = {}) {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, value);
      }
    });

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return api.get(`/api/inventory/assets${suffix}`);
  },
  getAssetById(id) {
    return api.get(`/api/inventory/assets/${id}`);
  },
  updateAssetStatus(id, status) {
    return api.patch(`/api/inventory/assets/${id}/status`, { status });
  },
};
