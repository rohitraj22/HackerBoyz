import { useEffect, useMemo, useState } from 'react';
import { pqcApi } from '../api/pqcApi';

const fallback = {
  counts: {
    elite: 0,
    standard: 0,
    legacy: 0,
    critical: 0,
  },
  applicationStatus: [],
  riskOverview: [],
  assets: [],
  recommendations: [],
  aiSummary: '',
};

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function assetName(asset = {}) {
  return normalizeText(asset.name || asset.hostname || asset.domain || asset.url || asset.commonName);
}

function pqcGrade(asset = {}) {
  return normalizeText(asset.grade || asset.pqc?.grade || '-');
}

function pqcSupport(asset = {}) {
  return normalizeText(asset.supportStatus || asset.pqc?.supportStatus || '-');
}

function pqcPriority(asset = {}) {
  return normalizeText(asset.migrationPriority || asset.pqc?.migrationPriority || '-');
}

function pqcScore(asset = {}) {
  const explicit = Number(asset.overallRiskScore);
  if (Number.isFinite(explicit)) return explicit;

  const grade = pqcGrade(asset).toLowerCase();
  if (grade === 'elite') return 820;
  if (grade === 'standard') return 640;
  if (grade === 'legacy') return 480;
  if (grade === 'critical') return 320;
  return 0;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function describeStatus(item, totalAssets) {
  const count = Math.max(0, Math.round((Number(item.percent || 0) / 100) * totalAssets));
  return `${item.label}: ${item.percent}% (${count} of ${totalAssets} assets).`;
}

function describeRiskTone(tone) {
  if (tone === 'critical') return 'Critical risk: immediate migration and hardening required.';
  if (tone === 'high') return 'High risk: prioritize in upcoming remediation cycle.';
  if (tone === 'moderate') return 'Moderate risk: track and improve in planned upgrades.';
  return 'Low risk: acceptable posture, monitor continuously.';
}

function toneFromGrade(grade = '') {
  const g = String(grade || '').toLowerCase();
  if (g === 'critical') return 'critical';
  if (g === 'legacy') return 'high';
  if (g === 'standard') return 'moderate';
  return 'safe';
}

function startsWithNumber(value) {
  return /^\d/.test(String(value || '').trim());
}

function gradeRank(value) {
  const grade = String(value || '').toLowerCase();
  if (grade === 'critical') return 4;
  if (grade === 'legacy') return 3;
  if (grade === 'standard') return 2;
  if (grade === 'elite') return 1;
  return 0;
}

function supportRank(value) {
  const support = String(value || '').toLowerCase();
  if (support === 'critical') return 4;
  if (support === 'legacy') return 3;
  if (support === 'partial' || support === 'standard') return 2;
  if (support === 'ready') return 1;
  return 0;
}

function priorityRank(value) {
  const priority = String(value || '').toLowerCase();
  if (priority === 'immediate') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  if (priority === 'low') return 1;
  return 0;
}

function statusDonutStyle(statusItems = []) {
  const total = statusItems.reduce((sum, item) => sum + Number(item.percent || 0), 0);
  if (!total) {
    return { background: 'conic-gradient(#d6e2ee 0deg, #d6e2ee 360deg)', legend: [] };
  }

  const palette = ['#5ab976', '#f0bd2d', '#ef8a2f', '#e05555'];
  let acc = 0;
  const stops = [];

  const legend = statusItems.map((item, index) => {
    const val = Number(item.percent || 0);
    const start = acc;
    acc += val / total;
    const color = palette[index % palette.length];
    stops.push(`${color} ${(start * 360).toFixed(2)}deg ${(acc * 360).toFixed(2)}deg`);

    return {
      label: item.label,
      percent: val,
      color,
    };
  });

  return { background: `conic-gradient(${stops.join(', ')})`, legend };
}

export default function PQCPosturePage() {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [assetLoading, setAssetLoading] = useState(false);
  const [selectedExposureKey, setSelectedExposureKey] = useState('');
  const [statusHoverText, setStatusHoverText] = useState('Move over donut segments to inspect status distribution.');
  const [riskHoverText, setRiskHoverText] = useState('Move over heatmap cells to inspect risk context.');

  useEffect(() => {
    const loadPqc = async () => {
      try {
        const res = await pqcApi.getOverview('latest');
        setData({ ...fallback, ...(res.data || {}) });
      } catch (err) {
        setError(err.message || 'Failed to load PQC posture');
      } finally {
        setLoading(false);
      }
    };

    loadPqc();
  }, []);

  useEffect(() => {
    const loadAssets = async () => {
      try {
        setAssetLoading(true);
        const res = await pqcApi.listAssets(gradeFilter);
        setData((prev) => ({ ...prev, assets: Array.isArray(res.data?.assets) ? res.data.assets : [] }));
      } catch (err) {
        setError(err.message || 'Failed to load PQC assets');
      } finally {
        setAssetLoading(false);
      }
    };

    loadAssets();
  }, [gradeFilter]);

  const groupedAssets = useMemo(() => {
    const groups = new Map();

    for (const asset of data.assets || []) {
      const displayName = assetName(asset);
      if (startsWithNumber(displayName)) {
        continue;
      }

      const exposure = normalizeText(asset.exposure || asset.url || asset.domain || asset.hostname || asset.target);
      const key = (exposure === '-' ? displayName : exposure).toLowerCase();

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          exposure: exposure === '-' ? displayName : exposure,
          items: [],
          representative: asset,
        });
      }

      const group = groups.get(key);
      group.items.push(asset);

      const current = group.representative;
      const currentPriority = priorityRank(pqcPriority(current));
      const incomingPriority = priorityRank(pqcPriority(asset));
      const currentGrade = gradeRank(pqcGrade(current));
      const incomingGrade = gradeRank(pqcGrade(asset));

      if (incomingPriority > currentPriority || (incomingPriority === currentPriority && incomingGrade > currentGrade)) {
        group.representative = asset;
      }
    }

    return Array.from(groups.values())
      .map((group) => {
        const strongestSupport = group.items.reduce((max, item) => {
          const rank = supportRank(pqcSupport(item));
          return rank > max ? rank : max;
        }, 0);

        const strongestGrade = group.items.reduce((max, item) => {
          const rank = gradeRank(pqcGrade(item));
          return rank > max ? rank : max;
        }, 0);

        const strongestPriority = group.items.reduce((max, item) => {
          const rank = priorityRank(pqcPriority(item));
          return rank > max ? rank : max;
        }, 0);

        const rankToSupport = { 4: 'critical', 3: 'legacy', 2: 'partial', 1: 'ready', 0: '-' };
        const rankToGrade = { 4: 'critical', 3: 'legacy', 2: 'standard', 1: 'elite', 0: '-' };
        const rankToPriority = { 4: 'Immediate', 3: 'High', 2: 'Medium', 1: 'Low', 0: '-' };

        return {
          key: group.key,
          exposure: group.exposure,
          count: group.items.length,
          representative: group.representative,
          supportStatus: rankToSupport[strongestSupport],
          grade: rankToGrade[strongestGrade],
          migrationPriority: rankToPriority[strongestPriority],
        };
      })
      .sort((a, b) => a.exposure.localeCompare(b.exposure));
  }, [data.assets]);

  const riskCells = useMemo(() => {
    const toneOrder = { critical: 4, high: 3, moderate: 2, safe: 1 };

    const mapped = groupedAssets
      .map((item) => ({
        tone: toneFromGrade(item.grade),
        label: item.exposure,
        grade: normalizeText(item.grade),
        count: item.count,
      }))
      .sort((a, b) => {
        const toneDiff = (toneOrder[b.tone] || 0) - (toneOrder[a.tone] || 0);
        if (toneDiff !== 0) return toneDiff;
        return (b.count || 0) - (a.count || 0);
      });

    const cells = mapped.slice(0, 9);

    while (cells.length < 9) {
      cells.push({ tone: 'safe', label: 'No exposure', grade: 'safe', count: 0 });
    }

    return cells;
  }, [groupedAssets]);

  const tableGradeCounts = useMemo(() => {
    return groupedAssets.reduce(
      (acc, item) => {
        const grade = String(item.grade || '').toLowerCase();
        if (grade === 'elite') acc.elite += 1;
        else if (grade === 'standard') acc.standard += 1;
        else if (grade === 'legacy') acc.legacy += 1;
        else if (grade === 'critical') acc.critical += 1;
        return acc;
      },
      { elite: 0, standard: 0, legacy: 0, critical: 0 }
    );
  }, [groupedAssets]);

  const tableTotalAssets = useMemo(
    () => tableGradeCounts.elite + tableGradeCounts.standard + tableGradeCounts.legacy + tableGradeCounts.critical,
    [tableGradeCounts.critical, tableGradeCounts.elite, tableGradeCounts.legacy, tableGradeCounts.standard]
  );

  const tableStatusItems = useMemo(() => {
    const total = Math.max(1, tableTotalAssets);
    return [
      { label: 'Elite-PQC Ready', percent: Math.round((tableGradeCounts.elite / total) * 100) },
      { label: 'Standard', percent: Math.round((tableGradeCounts.standard / total) * 100) },
      { label: 'Legacy', percent: Math.round((tableGradeCounts.legacy / total) * 100) },
      { label: 'Critical', percent: Math.round((tableGradeCounts.critical / total) * 100) },
    ];
  }, [tableGradeCounts.critical, tableGradeCounts.elite, tableGradeCounts.legacy, tableGradeCounts.standard, tableTotalAssets]);

  const chartTotalAssets = tableTotalAssets;

  const chartStatusDonut = useMemo(() => statusDonutStyle(tableStatusItems), [tableStatusItems]);

  useEffect(() => {
    if (!groupedAssets.length) {
      setSelectedExposureKey('');
      return;
    }

    const found = groupedAssets.some((group) => group.key === selectedExposureKey);
    if (!found) {
      setSelectedExposureKey(groupedAssets[0].key);
    }
  }, [groupedAssets, selectedExposureKey]);

  const selectedAsset = useMemo(
    () => groupedAssets.find((group) => group.key === selectedExposureKey) || null,
    [groupedAssets, selectedExposureKey]
  );

  const handleDonutMouseMove = (event) => {
    const statusItems = tableStatusItems || [];
    if (!statusItems.length || chartTotalAssets <= 0) {
      setStatusHoverText('No status distribution available.');
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    const radius = Math.sqrt(dx * dx + dy * dy);
    const outer = rect.width / 2;
    const inner = 37;

    if (radius < inner || radius > outer) {
      setStatusHoverText('Move over the ring to inspect each status slice.');
      return;
    }

    const angle = (Math.atan2(dy, dx) * (180 / Math.PI) + 450) % 360;
    const totalPercent = statusItems.reduce((sum, item) => sum + Number(item.percent || 0), 0);

    if (!totalPercent) {
      setStatusHoverText('No status distribution available.');
      return;
    }

    let acc = 0;
    for (const item of statusItems) {
      const span = (Number(item.percent || 0) / totalPercent) * 360;
      const start = acc;
      const end = acc + span;
      if (angle >= start && angle <= end) {
        setStatusHoverText(describeStatus(item, chartTotalAssets));
        return;
      }
      acc = end;
    }

    setStatusHoverText('Move over the ring to inspect each status slice.');
  };

  const appDetails = useMemo(() => {
    if (!selectedAsset) return [];

    const representative = selectedAsset.representative || {};

    return [
      { label: 'Exposure', value: selectedAsset.exposure },
      { label: 'Grouped Assets', value: String(selectedAsset.count) },
      { label: 'Representative App', value: assetName(representative) },
      { label: 'App Name', value: normalizeText(representative.appName || representative.metadata?.appName) },
      { label: 'Asset Type', value: normalizeText(representative.assetType || representative.type) },
      { label: 'Target', value: normalizeText(representative.target || representative.metadata?.target) },
      { label: 'Owner', value: normalizeText(representative.owner || representative.metadata?.owner || representative.companyName) },
      { label: 'Host / IP', value: normalizeText(representative.hostname || representative.ipAddress) },
      { label: 'TLS Version', value: normalizeText(representative.tlsVersion || representative.protocol) },
      { label: 'Cipher Suite', value: normalizeText(representative.cipher || representative.cipherSuite) },
      { label: 'Key Length', value: normalizeText(representative.keyLength || representative.metadata?.keyLength) },
      { label: 'Certificate Authority', value: normalizeText(representative.certificateAuthority || representative.issuer) },
      { label: 'Score', value: `${pqcScore(representative)} (${normalizeText(selectedAsset.grade)})` },
      { label: 'PQC Support', value: normalizeText(selectedAsset.supportStatus) },
      { label: 'Priority', value: normalizeText(selectedAsset.migrationPriority) },
      { label: 'Risk Severity', value: normalizeText(representative.severity || representative.riskSeverity) },
      { label: 'Findings', value: String(representative.findingCount || representative.findings?.length || 0) },
      { label: 'Last Seen', value: formatDate(representative.updatedAt || representative.createdAt) },
    ];
  }, [selectedAsset]);

  if (loading) {
    return (
      <div className="page-stack">
        <div className="card">
          <div className="loader-wrap">
            <div className="loader" />
            <span>Loading PQC posture...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="card pqc-board">
        <div className="pqc-board-header">
          <h2>PQC Compliance Dashboard</h2>
          <div className="pqc-top-stats">
            <span>Elite-PQC Ready: <strong>{tableGradeCounts.elite}</strong></span>
            <span>Standard: <strong>{tableGradeCounts.standard}</strong></span>
            <span>Legacy: <strong>{tableGradeCounts.legacy}</strong></span>
            <span>Critical Apps: <strong>{tableGradeCounts.critical}</strong></span>
          </div>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="pqc-dashboard-grid">
          <article className="pqc-widget">
            <h3>Assets by Classification Grade</h3>
            <div className="pqc-grade-bars">
              {[
                { label: 'Elite', value: tableGradeCounts.elite, tone: 'elite' },
                { label: 'Standard', value: tableGradeCounts.standard, tone: 'standard' },
                { label: 'Legacy', value: tableGradeCounts.legacy, tone: 'legacy' },
                { label: 'Critical', value: tableGradeCounts.critical, tone: 'critical' },
              ].map((item) => {
                const height = chartTotalAssets ? Math.max(16, (item.value / chartTotalAssets) * 150) : 16;
                return (
                  <div className="pqc-grade-bar" key={item.label}>
                    <div className="pqc-grade-track">
                      <div className={`pqc-grade-fill ${item.tone}`} style={{ height }}>
                        <span>{item.value}</span>
                      </div>
                    </div>
                    <label>{item.label}</label>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="pqc-widget">
            <h3>Application Status</h3>
            <div className="pqc-status-wrap">
              <div
                className="pqc-status-donut"
                style={{ background: chartStatusDonut.background }}
                onMouseMove={handleDonutMouseMove}
                onMouseLeave={() => setStatusHoverText('Move over donut segments to inspect status distribution.')}
              >
                <div className="pqc-status-hole" />
              </div>
              <div className="pqc-status-legend">
                {chartStatusDonut.legend.length ? chartStatusDonut.legend.map((item) => (
                  <div className="pqc-legend-item" key={item.label}>
                    <span className="dot" style={{ background: item.color }} />
                    <span>{item.label}</span>
                    <strong>{item.percent}%</strong>
                  </div>
                )) : <div className="empty-state">No status distribution.</div>}
              </div>
            </div>
            <p className="pqc-hover-hint">
              <span className="pqc-hover-icon" aria-hidden="true">ⓘ</span>
              <span>{statusHoverText}</span>
            </p>
          </article>

          <article className="pqc-widget">
            <h3>Risk Overview</h3>
            <div className="pqc-risk-board">
              {riskCells.map((cell, index) => (
                <div
                  className={`pqc-risk-cell ${cell.tone}`}
                  key={index}
                  onMouseEnter={() => setRiskHoverText(`${cell.label}: ${cell.grade} grade, ${cell.count} grouped assets. ${describeRiskTone(cell.tone)}`)}
                  onMouseLeave={() => setRiskHoverText('Move over heatmap cells to inspect risk context.')}
                >
                  <span className="pqc-risk-cell-label">{cell.label}</span>
                  <span className="pqc-risk-cell-meta">{cell.grade} · {cell.count}</span>
                </div>
              ))}
            </div>
            <p className="pqc-hover-hint">
              <span className="pqc-hover-icon" aria-hidden="true">ⓘ</span>
              <span>{riskHoverText}</span>
            </p>
            <div className="pqc-risk-legend">
              <span><i className="critical" /> Critical Grade</span>
              <span><i className="high" /> Legacy Grade</span>
              <span><i className="moderate" /> Standard Grade</span>
              <span><i className="safe" /> Elite / Low Risk</span>
            </div>
          </article>

          <article className="pqc-widget pqc-assets-panel">
            <div className="pqc-widget-head">
              <h3>Assets & PQC Support</h3>
              <label>
                Grade Filter
                <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="elite">Elite</option>
                  <option value="standard">Standard</option>
                  <option value="legacy">Legacy</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
            </div>

            {assetLoading ? (
              <div className="loader-wrap">
                <div className="loader" />
                <span>Loading PQC assets...</span>
              </div>
            ) : groupedAssets.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Exposure</th>
                      <th>PQC Support</th>
                      <th>Grade</th>
                      <th>Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedAssets.map((assetGroup) => {
                      const id = assetGroup.key;
                      const isSelected = id === selectedExposureKey;
                      const support = normalizeText(assetGroup.supportStatus).toLowerCase();

                      return (
                        <tr
                          key={id}
                          className={isSelected ? 'active' : ''}
                          onClick={() => setSelectedExposureKey(id)}
                        >
                          <td>{assetGroup.exposure}</td>
                          <td>
                            <span className={`pqc-support-pill ${support || 'partial'}`}>{normalizeText(assetGroup.supportStatus)}</span>
                          </td>
                          <td>{normalizeText(assetGroup.grade)}</td>
                          <td>{normalizeText(assetGroup.migrationPriority)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No PQC asset data available.</div>
            )}
          </article>

          <article className="pqc-widget pqc-app-details">
            <h3>App Details</h3>
            {selectedAsset ? (
              <div className="pqc-details-list">
                {appDetails.map((entry) => (
                  <p key={entry.label}><strong>{entry.label}:</strong> {entry.value}</p>
                ))}
              </div>
            ) : (
              <div className="empty-state">Select an asset to see details.</div>
            )}
          </article>

          <article className="pqc-widget pqc-recommendations">
            <h3>Improvement Recommendations</h3>
            {data.recommendations.length ? (
              <ul className="bullet-list">
                {data.recommendations.map((item, index) => (
                  <li key={item._id || index}>{item.title || item}</li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">No PQC recommendations yet.</div>
            )}
            {data.aiSummary ? <p className="recommendation-summary">{data.aiSummary}</p> : null}
          </article>
        </div>
      </section>
    </div>
  );
}