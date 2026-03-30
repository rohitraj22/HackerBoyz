import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { scanApi } from '../api/scanApi';

const fallback = {
  totals: {
    applications: 0,
    certificates: 0,
    weakCryptography: 0,
    certificateIssues: 0,
  },
  keyLengthDistribution: [],
  cipherUsage: [],
  authorities: [],
  protocolDistribution: [],
  rows: [],
  targetSummaries: [],
  aiSummary: '',
};

function normalizeItems(list = []) {
  return Array.isArray(list) ? list : [];
}

function normalizeField(value) {
  const text = String(value ?? '').trim();
  return text && text !== '-' ? text : '-';
}

function resolveTarget(scan = {}, inventory = {}) {
  return normalizeField(
    scan.domain ||
    scan.apiEndpoint ||
    scan.target ||
    scan.name ||
    inventory.host ||
    inventory.commonName
  );
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
}

function recommendationPoints(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const bulletLines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-') || /^\d+[.)]/.test(line))
    .map((line) => line.replace(/^[-\d.)\s]+/, '').trim())
    .filter(Boolean);

  if (bulletLines.length) return bulletLines.slice(0, 5);

  return raw
    .split(/\.(\s+|$)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function countBy(items, formatter) {
  const map = new Map();

  for (const item of items) {
    const label = normalizeField(formatter(item));
    if (label === '-') continue;
    map.set(label, (map.get(label) || 0) + 1);
  }

  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function isWeakProtocol(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('ssl') || text.includes('tlsv1.0') || text.includes('tlsv1.1') || text.includes('tls1.0') || text.includes('tls1.1');
}

function isWeakCipher(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('rc4') || text.includes('3des') || text.includes('md5') || text.includes('sha1') || text.includes('des_');
}

function buildCbomFromHistory(scans = []) {
  const rows = scans.map((scan) => {
    const inventory = scan.inventory || {};
    const target = resolveTarget(scan, inventory);

    return {
      _id: scan._id,
      target,
      application: target,
      createdAt: scan.createdAt || null,
      riskLevel: normalizeField(scan.riskLevel),
      overallRiskScore: scan.overallRiskScore ?? '-',
      registrationDate: inventory.registrationDate || null,
      sslShaFingerprint: normalizeField(inventory.sslShaFingerprint),
      registrarCompanyName: normalizeField(inventory.registrarCompanyName),
      commonName: normalizeField(inventory.commonName),
      host: normalizeField(inventory.host),
      port: normalizeField(inventory.port),
      version: normalizeField(inventory.version),
      type: normalizeField(inventory.type),
      location: normalizeField(inventory.location),
      netname: normalizeField(inventory.netname),
      companyName: normalizeField(inventory.companyName),
      keyLength: normalizeField(inventory.keyLength || inventory.key_length),
      cipher: normalizeField(inventory.cipher || inventory.cipherSuite || inventory.sslCipher || inventory.sslCipherSuite),
      certificateAuthority: normalizeField(
        inventory.certificateAuthority || inventory.registrarCompanyName || inventory.companyName || inventory.issuer
      ),
      tlsVersion: normalizeField(inventory.tlsVersion || inventory.version || inventory.sslVersion),
      validTo: inventory.validTo || inventory.expiresAt || null,
    };
  });

  const namedApplications = new Set(rows.map((row) => row.application).filter((value) => value !== '-'));
  const certificates = rows.filter((row) => row.certificateAuthority !== '-').length;
  const weakCryptography = rows.filter((row) => isWeakProtocol(row.tlsVersion) || isWeakCipher(row.cipher)).length;
  const certificateIssues = rows.filter((row) => {
    if (!row.validTo) return false;
    const expiry = new Date(row.validTo);
    return !Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now();
  }).length;

  return {
    totals: {
      applications: namedApplications.size,
      certificates,
      weakCryptography,
      certificateIssues,
    },
    keyLengthDistribution: countBy(rows, (row) => row.keyLength).slice(0, 8),
    cipherUsage: countBy(rows, (row) => row.cipher).slice(0, 8),
    authorities: countBy(rows, (row) => row.certificateAuthority).slice(0, 8),
    protocolDistribution: countBy(rows, (row) => row.tlsVersion).slice(0, 8),
    rows,
    aiSummary: '',
  };
}

function protocolDonutStyle(items = []) {
  const normalized = normalizeItems(items).slice(0, 4);
  const total = normalized.reduce((sum, item) => sum + Number(item.value || 0), 0);

  if (!normalized.length || total <= 0) {
    return {
      background: 'conic-gradient(#d6e2ee 0deg, #d6e2ee 360deg)',
      segments: [],
    };
  }

  const palette = ['#88a8da', '#6f95cf', '#5f7ebf', '#46629d'];
  let cumulative = 0;
  const stops = [];

  const segments = normalized.map((item, index) => {
    const fraction = Number(item.value || 0) / total;
    const start = cumulative;
    cumulative += fraction;
    const color = palette[index % palette.length];
    stops.push(`${color} ${(start * 360).toFixed(2)}deg ${(cumulative * 360).toFixed(2)}deg`);
    return {
      ...item,
      color,
      percent: Math.round(fraction * 100),
    };
  });

  return {
    background: `conic-gradient(${stops.join(', ')})`,
    segments,
  };
}

export default function CBOMPage() {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSummaryByKey, setOpenSummaryByKey] = useState({});

  const cipherUsage = useMemo(
    () => normalizeItems(data.cipherUsage).slice(0, 5),
    [data.cipherUsage]
  );
  const authorities = useMemo(
    () => normalizeItems(data.authorities).slice(0, 5),
    [data.authorities]
  );
  const protocolDistribution = useMemo(
    () => normalizeItems(data.protocolDistribution).slice(0, 4),
    [data.protocolDistribution]
  );
  const rows = useMemo(() => normalizeItems(data.rows), [data.rows]);
  const targetSummaries = useMemo(
    () => normalizeItems(data.targetSummaries).filter((item) => normalizeField(item.target) !== '-'),
    [data.targetSummaries]
  );

  const sitesSurveyed = useMemo(() => {
    if (targetSummaries.length) return targetSummaries.length;

    const unique = new Set(rows.map((row) => normalizeField(row.target || row.application || row.name)).filter((value) => value !== '-'));
    return unique.size;
  }, [rows, targetSummaries]);

  const donut = useMemo(() => protocolDonutStyle(protocolDistribution), [protocolDistribution]);
  const maxCipherValue = Math.max(1, ...cipherUsage.map((item) => Number(item.value || 0)));

  function handleSummaryToggle(summaryKey, isOpen) {
    setOpenSummaryByKey((prev) => ({
      ...prev,
      [summaryKey]: isOpen,
    }));
  }

  useEffect(() => {
    const loadCbom = async () => {
      try {
        const requestedScanId = String(searchParams.get('scanId') || '').trim();
        const historyResponse = await scanApi.getHistory({ includeTargetSummaries: true });
        const scans = normalizeItems(historyResponse?.data?.data?.scans);
        const summaries = normalizeItems(historyResponse?.data?.data?.targetSummaries);
        const selectedScans = requestedScanId
          ? scans.filter((scan) => String(scan?._id || '') === requestedScanId)
          : scans;
        const selectedSummary = requestedScanId
          ? summaries.filter((summary) => normalizeItems(summary.scanIds).includes(requestedScanId))
          : summaries;

        const cbomData = buildCbomFromHistory(selectedScans);
        setData({ ...fallback, ...cbomData, targetSummaries: selectedSummary.length ? selectedSummary : summaries });
      } catch (err) {
        setError(err.message || 'Failed to load CBOM');
      } finally {
        setLoading(false);
      }
    };

    loadCbom();
  }, [searchParams]);

  if (loading) {
    return (
      <div className="page-stack">
        <div className="card">
          <div className="loader-wrap">
            <div className="loader" />
            <span>Loading CBOM...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="card cbom-board">
        {error ? <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div> : null}

        <div className="cbom-board-header">
          <h3>Cryptographic Bill of Materials</h3>
        </div>

        <div className="cbom-kpi-grid">
          <div className="cbom-kpi">
            <span>Total Targets</span>
            <strong>{data.totals.applications}</strong>
          </div>
          <div className="cbom-kpi">
            <span>Sites Surveyed</span>
            <strong>{sitesSurveyed}</strong>
          </div>
          <div className="cbom-kpi">
            <span>Active Certificates</span>
            <strong>{data.totals.certificates}</strong>
          </div>
          <div className="cbom-kpi">
            <span>Weak Cryptography</span>
            <strong>{data.totals.weakCryptography}</strong>
          </div>
          <div className="cbom-kpi">
            <span>Certificate Issues</span>
            <strong>{data.totals.certificateIssues}</strong>
          </div>
        </div>

        <div className="cbom-analytics-grid">
          <article className="cbom-panel">
            <h4>Cipher Usage</h4>
            {cipherUsage.length ? (
              <div className="cbom-rank-list">
                {cipherUsage.map((item, index) => (
                  <div className="cbom-rank-row" key={item.label || index}>
                    <span>{item.label}</span>
                    <div className="cbom-rank-track">
                      <div
                        className="cbom-rank-fill"
                        style={{ width: `${(Number(item.value || 0) / maxCipherValue) * 100}%` }}
                      />
                    </div>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No data available.</div>
            )}
          </article>

          <article className="cbom-panel">
            <h4>Top Certificate Authorities</h4>
            {authorities.length ? (
              <div className="cbom-authorities-list">
                {authorities.map((item, index) => (
                  <div className="cbom-authority-row" key={item.label || index}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No data available.</div>
            )}
          </article>

          <article className="cbom-panel">
            <h4>Encryption Protocols</h4>
            {protocolDistribution.length ? (
              <div className="cbom-protocol-wrap">
                <div className="cbom-donut" style={{ background: donut.background }}>
                  <div className="cbom-donut-hole" />
                </div>
                <div className="cbom-protocol-legend">
                  {donut.segments.map((item) => (
                    <div className="cbom-legend-row" key={item.label}>
                      <span className="cbom-dot" style={{ background: item.color }} />
                      <span>{item.label}</span>
                      <strong>{item.percent}%</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state">No data available.</div>
            )}
          </article>

          <article className="cbom-panel cbom-table-panel">
            <h4>Scan Summaries by Target</h4>
            {targetSummaries.length ? (
              <div className="cbom-summary-grid">
                {targetSummaries.map((summary) => {
                  const avgScore = Number(summary.averageScore || 0);
                  const scoreTone = avgScore >= 700 ? 'strong' : avgScore >= 400 ? 'moderate' : 'risk';
                  const points = recommendationPoints(summary.pqcRecommendation);
                  const summaryKey = String(summary.key || summary.target || 'target-summary');
                  const isSummaryOpen = Boolean(openSummaryByKey[summaryKey]);

                  return (
                    <article className={`cbom-summary-card ${scoreTone}`} key={summaryKey}>
                      <div className="cbom-summary-head">
                        <h5>{summary.target}</h5>
                        <div className="cbom-score-badge">Avg Score {avgScore}</div>
                      </div>

                      <div className="cbom-summary-metrics">
                        <span>Scans: {summary.scanCount || 0}</span>
                        <span>Latest: {formatDateTime(summary.latestAt)}</span>
                        <span>Top Protocol: {summary.topProtocol || 'Unknown'}</span>
                        <span>Top Cipher: {summary.topCipher || 'Unknown'}</span>
                        <span>Weak Protocol Hits: {summary.weakProtocolCount || 0}</span>
                        <span>Weak Cipher Hits: {summary.weakCipherCount || 0}</span>
                      </div>

                      <details
                        className="cbom-summary-details"
                        open={isSummaryOpen}
                        onToggle={(event) => handleSummaryToggle(summaryKey, event.currentTarget.open)}
                      >
                        <summary>
                          <span>PQC Recommendation Summary</span>
                          <span className="cbom-summary-caret">{isSummaryOpen ? 'Hide' : 'View'}</span>
                        </summary>
                        <div className="cbom-recommendation-block">
                          <h6>Action Plan</h6>
                          {points.length ? (
                            <ul>
                              {points.map((point, index) => (
                                <li key={index}>{point}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>Recommendation unavailable.</p>
                          )}
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">No target summaries available.</div>
            )}
          </article>
        </div>

        {data.aiSummary ? (
          <div className="cbom-summary-box">
            <h4>AI Summary</h4>
            <p>{data.aiSummary}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
