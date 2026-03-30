import axios from 'axios';

const api = axios.create({
  baseURL: '/',
  timeout: 60000,
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const detailFromArray = Array.isArray(data?.errors) && data.errors.length
      ? data.errors.join('; ')
      : '';
    const detailFromDetails = typeof data?.details === 'string' ? data.details : '';
    const detailFromDataMessage = typeof data?.error === 'string' ? data.error : '';

    const message =
      data?.message ||
      detailFromArray ||
      detailFromDetails ||
      detailFromDataMessage ||
      error?.message ||
      'Request failed';

    const normalizedError = new Error(message);
    normalizedError.status = status;
    normalizedError.original = error;

    return Promise.reject(normalizedError);
  }
);

export default api;