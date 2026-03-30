import { useState } from 'react';
import { scanApi } from '../api/scanApi';
import { useScanContext } from '../context/ScanContext';

export function useScan() {
  const { latestResult, setLatestResult } = useScanContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function runScan(payload) {
    try {
      setLoading(true);
      setError('');
      const response = await scanApi.runScan(payload);
      setLatestResult(response.data.data);
      return response.data.data;
    } catch (err) {
      setError(err.message || 'Scan failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return {
    loading,
    error,
    latestResult,
    runScan
  };
}
