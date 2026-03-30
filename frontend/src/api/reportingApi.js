import api from './axios';

function absoluteReportingUrl(path = '') {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = String(api.defaults.baseURL || '').replace(/\/+$/, '');
  const suffix = raw.startsWith('/') ? raw : `/${raw}`;
  return `${base}${suffix}`;
}

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
  getDownloadUrl(reportId, fallbackUrl = '') {
    const fallback = String(fallbackUrl || '').trim();
    if (fallback) {
      return absoluteReportingUrl(fallback);
    }
    return absoluteReportingUrl(`/api/reporting/generated/${reportId}/download`);
  },
};
