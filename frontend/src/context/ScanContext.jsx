import { createContext, useContext, useMemo, useState } from 'react';

const ScanContext = createContext(null);

export function ScanProvider({ children }) {
  const [latestResult, setLatestResult] = useState(null);

  const value = useMemo(() => ({
    latestResult,
    setLatestResult
  }), [latestResult]);

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function useScanContext() {
  const context = useContext(ScanContext);
  if (!context) {
    throw new Error('useScanContext must be used inside ScanProvider');
  }
  return context;
}
