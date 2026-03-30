import { useEffect, useMemo, useState } from 'react';
import { scanApi } from '../api/scanApi';
import Loader from '../components/common/Loader';
import { formatDate } from '../utils/formatDate';
import RiskCard from '../components/dashboard/RiskCard';
import ChartsSection from '../components/dashboard/ChartsSection';
import AssetTable from '../components/dashboard/AssetTable';
import RecommendationPanel from '../components/dashboard/RecommendationPanel';

const HISTORY_LIST_TAB_ID = 'history-list';

function displayCell(value) {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text || '-';
}

export default function HistoryPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [scanTabs, setScanTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(HISTORY_LIST_TAB_ID);

  useEffect(() => {
    async function load() {
      try {
        const response = await scanApi.getHistory();
        setPayload(response.data.data);
      } catch (err) {
        setError(err.message || 'Unable to load history');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const scans = payload?.scans || [];
  const stats = payload?.stats || {
    totalScans: 0,
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
  };

  const groupedScans = useMemo(() => {
    const grouped = new Map();

    for (const scan of scans) {
      const target = scan.domain || scan.apiEndpoint || 'Untitled scan';
      const key = target.toLowerCase();

      if (!grouped.has(key)) {
        grouped.set(key, { key, target, scans: [] });
      }

      grouped.get(key).scans.push(scan);
    }

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        latestAt: group.scans[0]?.createdAt || null,
      }))
      .sort((a, b) => new Date(b.latestAt || 0) - new Date(a.latestAt || 0));
  }, [scans]);

  if (loading) return <Loader text="Loading history..." />;
  if (error) return <div className="error-banner">{error}</div>;
  if (!payload) return null;

  const totalPages = Math.max(1, Math.ceil(groupedScans.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedGroups = groupedScans.slice(startIndex, startIndex + pageSize);
  const activeScanTab = activeTab === HISTORY_LIST_TAB_ID
    ? null
    : scanTabs.find((tab) => tab.id === activeTab) || null;
  const activeScanData = activeScanTab?.data || null;
  const scan = activeScanData?.scan || null;
  const assets = activeScanData?.assets || [];
  const recommendation = activeScanData?.recommendation;

  function getTabLabel(scanItem) {
    const target = scanItem?.domain || scanItem?.apiEndpoint || scanItem?.name || scanItem?.target || 'Scan';
    return target.length > 30 ? `${target.slice(0, 27)}...` : target;
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
      const index = prev.findIndex((item) => item.id === scanId);
      if (index === -1) return [...prev, nextTab];
      const copy = [...prev];
      copy[index] = nextTab;
      return copy;
    });
    setActiveTab(scanId);
  }

  function closeScanTab(event, tabId) {
    event.stopPropagation();
    setScanTabs((prev) => {
      const remaining = prev.filter((item) => item.id !== tabId);
      if (activeTab === tabId) {
        setActiveTab(remaining.length ? remaining[remaining.length - 1].id : HISTORY_LIST_TAB_ID);
      }
      return remaining;
    });
  }

  function toggleGroup(groupKey) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  async function openScanDetails(scanId) {
    if (!scanId) return;

    const existing = scanTabs.find((tab) => tab.id === scanId);
    if (existing) {
      setActiveTab(scanId);
      return;
    }

    try {
      const response = await scanApi.getScanById(scanId);
      upsertScanTab(response.data?.data);
    } catch (err) {
      setError(err.message || 'Failed to load scan details');
    }
  }

  function handlePageSizeChange(value) {
    const parsed = Number(value) || 5;
    setPageSize(parsed);
    setPage(1);
  }

  function handleMetricClick(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <div className="page-stack">
      {scanTabs.length ? (
        <div className="scan-browser card">
          <div className="scan-browser-tabs" role="tablist" aria-label="History scan tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === HISTORY_LIST_TAB_ID}
              className={`scan-browser-tab ${activeTab === HISTORY_LIST_TAB_ID ? 'active' : ''}`}
              onClick={() => setActiveTab(HISTORY_LIST_TAB_ID)}
            >
              History
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
                  onClick={(event) => closeScanTab(event, tab.id)}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === HISTORY_LIST_TAB_ID ? (
        <>
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Asset Inventory</h2>
                <p>Overview of saved scans and current severity distribution.</p>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-box"><strong>{stats.totalScans}</strong><span>Total</span></div>
              <div className="stat-box"><strong>{stats.critical}</strong><span>Critical</span></div>
              <div className="stat-box"><strong>{stats.high}</strong><span>High</span></div>
              <div className="stat-box"><strong>{stats.moderate}</strong><span>Moderate</span></div>
              <div className="stat-box"><strong>{stats.low}</strong><span>Low</span></div>
            </div>
          </div>

          <div className="card">
            <div className="card-header spread">
              <div>
                <h3>Grouped Scan History</h3>
                <p>Scans are grouped by target. Expand a target to view previous scan runs.</p>
              </div>

              <div className="history-pagination-controls">
                <label>
                  Scans per page
                  <select value={pageSize} onChange={(e) => handlePageSizeChange(e.target.value)}>
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="history-group-list">
              {paginatedGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.key);

                return (
                  <div key={group.key} className="history-group-card">
                    <button
                      type="button"
                      className="history-group-header"
                      onClick={() => toggleGroup(group.key)}
                    >
                      <div>
                        <strong>{group.target}</strong>
                        <p>{group.scans.length} scan{group.scans.length > 1 ? 's' : ''} • Latest: {formatDate(group.latestAt)}</p>
                      </div>
                      <span className="badge">{isExpanded ? 'Hide history' : 'Show history'}</span>
                    </button>

                    {isExpanded ? (
                      <div className="table-wrap history-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Created</th>
                              <th>Risk</th>
                              <th>Score</th>
                              <th>Registration Date</th>
                              <th>SSL SHA Fingerprint</th>
                              <th>Registrar Company Name</th>
                              <th>Common Name</th>
                              <th>Host</th>
                              <th>Port</th>
                              <th>Version</th>
                              <th>Type</th>
                              <th>Location</th>
                              <th>Netname</th>
                              <th>Company Name</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.scans.map((scanItem) => (
                              <tr
                                key={scanItem._id}
                                className="history-row-link"
                                onClick={() => openScanDetails(scanItem._id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    openScanDetails(scanItem._id);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                                title="Open scan details"
                              >
                                <td>{formatDate(scanItem.createdAt)}</td>
                                <td>{scanItem.riskLevel || '-'}</td>
                                <td>{scanItem.overallRiskScore ?? '-'}</td>
                                <td>{displayCell(scanItem.inventory?.registrationDate ? formatDate(scanItem.inventory.registrationDate) : '')}</td>
                                <td>{displayCell(scanItem.inventory?.sslShaFingerprint)}</td>
                                <td>{displayCell(scanItem.inventory?.registrarCompanyName)}</td>
                                <td>{displayCell(scanItem.inventory?.commonName)}</td>
                                <td>{displayCell(scanItem.inventory?.host)}</td>
                                <td>{displayCell(scanItem.inventory?.port)}</td>
                                <td>{displayCell(scanItem.inventory?.version)}</td>
                                <td>{displayCell(scanItem.inventory?.type)}</td>
                                <td>{displayCell(scanItem.inventory?.location)}</td>
                                <td>{displayCell(scanItem.inventory?.netname)}</td>
                                <td>{displayCell(scanItem.inventory?.companyName)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="history-pagination">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={currentPage <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}

      {activeTab !== HISTORY_LIST_TAB_ID && scan ? (
        <>
          <RiskCard score={scan.overallRiskScore} level={scan.riskLevel} summary={scan.summary} />
          <ChartsSection scan={scan} assets={assets} onMetricClick={handleMetricClick} />
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

          <RecommendationPanel recommendation={recommendation} />
        </>
      ) : null}

      {loading ? <Loader text="Loading history..." /> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
