import api from './axios';

export const reportingApi = {
  getOptions() {
    return api.get('/api/reporting/options');
  },
  generate(payload) {
    return api.post('/api/reporting/generate', payload);
  },
  createSchedule(payload) {
    return api.post('/api/reporting/schedules', payload);
  },
  listSchedules() {
    return api.get('/api/reporting/schedules');
  },
  updateSchedule(id, payload) {
    return api.patch(`/api/reporting/schedules/${id}`, payload);
  },
  deleteSchedule(id) {
    return api.delete(`/api/reporting/schedules/${id}`);
  },
  listGenerated() {
    return api.get('/api/reporting/generated');
  },
  downloadGenerated(id) {
    return api.get(`/api/reporting/generated/${id}/download`, { responseType: 'blob' });
  },
};
