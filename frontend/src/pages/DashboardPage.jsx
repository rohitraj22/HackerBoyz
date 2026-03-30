import { useEffect, useState } from 'react';
import { scanApi } from '../api/scanApi';
import { discoveryApi } from '../api/discoveryApi';
import { useScan } from '../hooks/useScan';
import { downloadCbomPdf } from '../utils/downloadCbomPdf';
import Loader from '../components/common/Loader';
import ScanForm from '../components/dashboard/ScanForm';
import RiskCard from '../components/dashboard/RiskCard';
import AssetTable from '../components/dashboard/AssetTable';
import RecommendationPanel from '../components/dashboard/RecommendationPanel';
import TimelineHistory from '../components/dashboard/TimelineHistory';
import ChartsSection from '../components/dashboard/ChartsSection';
import ScanGraphView from '../components/dashboard/ScanGraphView';

const RUN_SCAN_TAB_ID = 'run-scan';

export default function DashboardPage() {
  const { latestResult, loading, error, runScan } = useScan();
  const [history, setHistory] = useState([]);
  const [scanTabs, setScanTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(RUN_SCAN_TAB_ID);
  const [historyLoadingId, setHistoryLoadingId] = useState('');
  const [graphByScanId, setGraphByScanId] = useState({});

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const historyResponse = await scanApi.getHistory();

        setHistory(historyResponse.data.data.scans || []);
      } catch {
        setHistory([]);
      }
    }
    loadDashboardData();
  }, [latestResult]);

  useEffect(() => {
    const activeScanId = activeTab === RUN_SCAN_TAB_ID ? '' : activeTab;
    if (!activeScanId) return;

    const current = graphByScanId[activeScanId];
    if (current && (current.loading || current.data || current.error)) return;

    let cancelled = false;

    async function loadGraph() {
      setGraphByScanId((prev) => ({
        ...prev,
        [activeScanId]: { loading: true, data: null, error: '' },
      }));

      try {
        const res = await discoveryApi.getGraph(activeScanId);
        if (cancelled) return;
        setGraphByScanId((prev) => ({
          ...prev,
          [activeScanId]: {
            loading: false,
            data: {
              nodes: res.data?.nodes || [],
              edges: res.data?.edges || [],
              highlights: res.data?.highlights || [],
            },
            error: '',
          },
        }));
      } catch (err) {
        if (cancelled) return;
        setGraphByScanId((prev) => ({
          ...prev,
          [activeScanId]: {
            loading: false,
            data: null,
            error: err.message || 'Failed to load scan graph',
          },
        }));
      }
    }

    loadGraph();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  function getTabLabel(scan) {
    if (!scan) return 'Scan result';

    const target = scan.domain || scan.apiEndpoint || scan.name || scan.target || 'Scan result';
    if (target.length <= 30) return target;
    return `${target.slice(0, 27)}...`;
  }

  function upsertScanTab(data) {
    const scanId = data?.scan?._id;
    if (!scanId) return;

    const nextTab = {
      id: scanId,
      label: getTabLabel(data.scan),
      data,
    };

    setScanTabs((prev) => {
      const existingIndex = prev.findIndex((tab) => tab.id === scanId);
      if (existingIndex === -1) {
        return [...prev, nextTab];
      }

      const copy = [...prev];
      copy[existingIndex] = nextTab;
      return copy;
    });
    setActiveTab(scanId);
  }

  function handleCloseTab(event, tabId) {
    event.stopPropagation();
    setScanTabs((prev) => {
      const remaining = prev.filter((tab) => tab.id !== tabId);
      if (activeTab === tabId) {
        setActiveTab(remaining.length ? remaining[remaining.length - 1].id : RUN_SCAN_TAB_ID);
      }
      return remaining;
    });
  }

  async function handleRunScan(payload) {
    const data = await runScan(payload);
    upsertScanTab(data);
  }

  async function handleOpenHistoryScan(scanId) {
    if (!scanId) return;

    const existingTab = scanTabs.find((tab) => tab.id === scanId);
    if (existingTab) {
      setActiveTab(scanId);
      return;
    }

    try {
      setHistoryLoadingId(scanId);
      const response = await scanApi.getScanById(scanId);
      upsertScanTab(response.data?.data);
    } catch {
      // Keep silent here; global error UI remains reserved for run-scan errors.
    } finally {
      setHistoryLoadingId('');
    }
  }

  function handleMetricClick(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const activeScanTab = activeTab === RUN_SCAN_TAB_ID
    ? null
    : scanTabs.find((tab) => tab.id === activeTab) || null;
  const scanData = activeScanTab?.data || latestResult;
  const scan = activeTab === RUN_SCAN_TAB_ID ? null : scanData?.scan;
  const assets = scanData?.assets || [];
  const recommendation = scanData?.recommendation;
  const showTabStrip = scanTabs.length > 0;
  const graphState = scan ? graphByScanId[scan._id] || { loading: false, data: null, error: '' } : null;

  return (
    <div className="page-stack">
      {showTabStrip ? (
        <div className="scan-browser card">
          <div className="scan-browser-tabs" role="tablist" aria-label="Scan result tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === RUN_SCAN_TAB_ID}
              className={`scan-browser-tab ${activeTab === RUN_SCAN_TAB_ID ? 'active' : ''}`}
              onClick={() => setActiveTab(RUN_SCAN_TAB_ID)}
            >
              Run Scan
            </button>

            {scanTabs.map((tab) => (
              <div
                key={tab.id}
                className={`scan-browser-tab-group ${activeTab === tab.id ? 'active' : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className="scan-browser-tab"
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                >
                  {tab.label}
                </button>
                <button
                  type="button"
                  className="scan-browser-close"
                  aria-label={`Close ${tab.label}`}
                  onClick={(event) => handleCloseTab(event, tab.id)}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === RUN_SCAN_TAB_ID ? <ScanForm onSubmit={handleRunScan} loading={loading} /> : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <Loader text="Running scanners and generating recommendations..." /> : null}

      {scan ? (
        <>
          <RiskCard
            score={scan.overallRiskScore}
            level={scan.riskLevel}
            summary={scan.summary}
          />

          <div className="row-actions">
            <button
              className="btn btn-secondary"
              onClick={() => downloadCbomPdf(scan, scan.cbom || {})}
            >
              Download CBOM
            </button>
          </div>

          <ChartsSection scan={scan} assets={assets} onMetricClick={handleMetricClick} />
          <div className="card">
            <div className="card-header">
              <div>
                <h3>Asset Relation Graph</h3>
                <p>Node-edge relationship view for this scan.</p>
              </div>
            </div>
            <ScanGraphView
              graph={graphState?.data}
              loading={Boolean(graphState?.loading)}
              error={graphState?.error || ''}
            />
          </div>
          <AssetTable assets={assets} scan={scan} />
          <div className="card" id="findings-section">
            <div className="card-header">
              <div>
                <h3>Findings</h3>
                <p>Detected security findings from this scan.</p>
              </div>
            </div>
            {(scan.findings || []).length ? (
              <ul className="bullet-list">
                {scan.findings.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">No findings for this scan.</div>
            )}
          </div>
          <div className="card" id="warnings-section">
            <div className="card-header">
              <div>
                <h3>Warnings</h3>
                <p>Operational warnings and scanner limitations.</p>
              </div>
            </div>
            {(scan.warnings || []).length ? (
              <ul className="bullet-list warning-list">
                {scan.warnings.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">No warnings for this scan.</div>
            )}
          </div>
          <RecommendationPanel
            recommendation={recommendation}
          />
        </>
      ) : null}

      {activeTab === RUN_SCAN_TAB_ID ? (
        <TimelineHistory
          scans={history}
          onSelectScan={handleOpenHistoryScan}
          loadingScanId={historyLoadingId}
        />
      ) : null}
    </div>
  );
}
