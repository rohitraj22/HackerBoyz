import { useEffect, useMemo, useState } from 'react';
import { ratingApi } from '../api/ratingApi';

const fallback = {
  normalizedScore: 0,
  label: 'Not Rated',
  factors: [],
  urlScores: [],
  aiSummary: '',
  tiers: [
    { tier: 'Legacy', range: '< 400', note: 'Immediate remediation needed' },
    { tier: 'Standard', range: '400 - 700', note: 'Acceptable but improvable' },
    { tier: 'Elite-PQC', range: '> 700', note: 'Strong security posture' },
  ],
};

export default function CyberRatingPage() {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assetScores, setAssetScores] = useState([]);

  useEffect(() => {
    const loadRating = async () => {
      try {
        const [ratingRes, assetsRes] = await Promise.all([
          ratingApi.getEnterprise('latest'),
          ratingApi.listAssets(),
        ]);

        setAssetScores(Array.isArray(assetsRes.data?.assets) ? assetsRes.data.assets : []);
        setData({ ...fallback, ...(ratingRes.data || {}) });
      } catch (err) {
        setError(err.message || 'Failed to load cyber rating');
      } finally {
        setLoading(false);
      }
    };

    loadRating();
  }, []);

  const normalized = useMemo(() => {
    const value = Number(data.normalizedScore || 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1000, Math.round(value)));
  }, [data.normalizedScore]);

  const normalizedLabel = useMemo(() => String(data.label || '').toLowerCase(), [data.label]);

  const scoreBadgeClass = useMemo(() => {
    if (normalizedLabel.includes('critical') || normalizedLabel.includes('legacy')) return 'badge-critical';
    if (normalizedLabel.includes('standard')) return 'badge-moderate';
    return 'badge-low';
  }, [normalizedLabel]);

  const tierMatrix = useMemo(() => {
    return [
      {
        tier: 'Tier-1 Elite',
        level: 'Modern best-practice crypto posture',
        criteria: 'TLS 1.2 / TLS 1.3 only, strong ciphers, forward secrecy, key length >= 3072 preferred, no weak protocol indicators.',
        action: 'Maintain baseline, monitor continuously, and keep as reference configuration.',
      },
      {
        tier: 'Tier-2 Standard',
        level: 'Acceptable enterprise configuration',
        criteria: 'TLS 1.2 supported with controlled compatibility, strong cipher preference, key length >= 2048.',
        action: 'Harden incrementally, remove weak compatibility paths, standardize cipher suites.',
      },
      {
        tier: 'Tier-3 Legacy',
        level: 'Weak but still operational',
        criteria: 'TLS 1.0 / TLS 1.1 exposure, weak cipher traces, or key length likely near 1024-bit.',
        action: 'Prioritize remediation plan, rotate certificates, and phase out weak algorithms.',
      },
      {
        tier: 'Critical',
        level: 'Insecure / exploitable posture',
        criteria: 'Severely weak protocol/cipher posture, very weak keys, or known high-risk crypto misconfiguration.',
        action: 'Immediate containment, isolate exposed services, and enforce emergency hardening.',
      },
    ];
  }, []);

  const formatPqcScore = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return Math.max(0, Math.min(100, Math.round(numeric)));
  };

  const normalizeAssetUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
      const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const parsed = new URL(withProtocol);
      return parsed.hostname.toLowerCase();
    } catch {
      return raw
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/:\d+$/, '');
    }
  };

  const normalizedAssetRows = useMemo(() => {
    const sourceRows = data.urlScores.length
      ? data.urlScores.map((row) => ({
          url: String(row.url || row.asset || '').trim(),
          score: Number(row.score),
        }))
      : assetScores.map((asset) => ({
          url: String(asset.name || '').trim(),
          score: Number(asset.score),
        }));

    const grouped = new Map();

    for (const row of sourceRows) {
      const canonicalUrl = normalizeAssetUrl(row.url || '-');
      if (!canonicalUrl || /^\d/.test(canonicalUrl)) {
        continue;
      }

      const key = canonicalUrl;
      if (!grouped.has(key)) {
        grouped.set(key, {
          url: canonicalUrl,
          sum: 0,
          count: 0,
        });
      }

      const bucket = grouped.get(key);
      const score = Number.isFinite(row.score) ? row.score : 0;
      bucket.sum += score;
      bucket.count += 1;
    }

    return [...grouped.values()]
      .map((item) => ({
        url: item.url,
        score: item.count ? item.sum / item.count : 0,
      }))
      .sort((a, b) => a.url.localeCompare(b.url));
  }, [assetScores, data.urlScores]);

  const contributorFactors = useMemo(
    () => (Array.isArray(data.factors) ? data.factors : []).filter((factor) => Number(factor?.value || 0) !== 0),
    [data.factors]
  );

  if (loading) {
    return (
      <div className="page-stack">
        <div className="card">
          <div className="loader-wrap">
            <div className="loader" />
            <span>Loading enterprise cyber rating...</span>
          </div>
        </div>
      </div>
    );
  }

  const maxFactor = Math.max(1, ...contributorFactors.map((f) => Number(f.value || 0)));

  return (
    <div className="page-stack">
      <section className="card cyber-rating-board">
        <div className="card-header">
          <div>
            <h2>Consolidated Enterprise-Level Cyber-Rating Score</h2>
            <p>PQC-oriented security posture for discovered public-facing assets.</p>
          </div>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="cyber-rating-hero">
          <div className="cyber-rating-scorebox">
            <div className="cyber-rating-score">{normalized}/1000</div>
            <div>
              <div className={`badge ${scoreBadgeClass}`}>{data.label || 'Not Rated'}</div>
              <p className="cyber-rating-score-caption">Indicates current enterprise cryptographic posture.</p>
            </div>
          </div>
          <div className="cyber-rating-summary">
            <h4>Explanation</h4>
            <p>{data.aiSummary || 'No explanation available yet.'}</p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>PQC Rating Framework</h3>
            <p>Tier definitions and recommended response for each score bucket.</p>
          </div>
        </div>
        <div className="table-wrap cyber-rating-tier-table">
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Security Level</th>
                <th>Compliance Criteria</th>
                <th>Priority / Action</th>
              </tr>
            </thead>
            <tbody>
              {tierMatrix.map((row) => (
                <tr key={row.tier}>
                  <td>{row.tier}</td>
                  <td>{row.level}</td>
                  <td>{row.criteria}</td>
                  <td>{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Enterprise Rating Bands</h3>
              <p>Status mapping used for score normalization.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>PQC Rating For Enterprise</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Legacy</td>
                  <td>&lt; 400</td>
                </tr>
                <tr>
                  <td>Standard</td>
                  <td>400 till 700</td>
                </tr>
                <tr>
                  <td>Elite-PQC</td>
                  <td>&gt; 700</td>
                </tr>
                <tr>
                  <td>Maximum Score after normalization</td>
                  <td>1000</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3>Score Contributors</h3>
              <p>What is driving the current enterprise score.</p>
            </div>
          </div>

          {contributorFactors.length ? (
            <div className="bars">
              {contributorFactors.map((factor, index) => (
                <div className="bar-row" key={factor.name || index}>
                  <span className="bar-label">{factor.name}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(Number(factor.value || 0) / maxFactor) * 100}%` }}
                    />
                  </div>
                  <span className="bar-value">{factor.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No factor data available.</div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>URL / Asset PQC Scores</h3>
            <p>Per-target score breakdown from the latest calculated rating model.</p>
          </div>
        </div>

        {normalizedAssetRows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>PQC Score</th>
                </tr>
              </thead>
              <tbody>
                {normalizedAssetRows.map((row) => (
                  <tr key={row.url}>
                    <td>{row.url || '-'}</td>
                    <td>{formatPqcScore(row.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No asset score data available.</div>
        )}
      </section>
    </div>
  );
}