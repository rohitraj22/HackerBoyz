import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { scanApi } from '../api/scanApi';
import { reportApi } from '../api/reportApi';
import { downloadJson } from '../utils/downloadJson';
import { downloadCbomPdf } from '../utils/downloadCbomPdf';
import Loader from '../components/common/Loader';
import RiskCard from '../components/dashboard/RiskCard';
import AssetTable from '../components/dashboard/AssetTable';
import RecommendationPanel from '../components/dashboard/RecommendationPanel';
import ChartsSection from '../components/dashboard/ChartsSection';

function CbomOverview({ cbom }) {
  if (!cbom || typeof cbom !== 'object') {
    return <div className="empty-state">No CBOM details available.</div>;
  }

  const inputs = cbom.inputs || {};
  const assets = Array.isArray(cbom.assets) ? cbom.assets : [];
  const findings = Array.isArray(cbom.findings) ? cbom.findings : [];

  return (
    <div className="page-stack">
      <div className="grid-3">
        <div className="stat-box">
          <strong>{cbom.risk_level || '-'}</strong>
          <span>Risk Level</span>
        </div>
        <div className="stat-box">
          <strong>{cbom.overall_risk_score ?? '-'}</strong>
          <span>Security Score</span>
        </div>
        <div className="stat-box">
          <strong>{assets.length}</strong>
          <span>Discovered Assets</span>
        </div>
      </div>

      <div className="recommendation-section">
        <h4>Scan Context</h4>
        <p>Domain: {inputs.domain || '-'}</p>
        <p>API Endpoint: {inputs.apiEndpoint || '-'}</p>
      </div>

      <div className="recommendation-section">
        <h4>Key Findings</h4>
        {findings.length ? (
          <ul className="bullet-list">
            {findings.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>No findings reported.</p>
        )}
      </div>

      {assets.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset Type</th>
                <th>Target</th>
                <th>TLS</th>
                <th>Cipher</th>
                <th>Key Exchange</th>
                <th>Signature</th>
                <th>Issuer</th>
                <th>HTTP Status</th>
                <th>Quantum Safe</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset, index) => (
                <tr key={`${asset.target || 'asset'}-${index}`}>
                  <td>{asset.asset_type || '-'}</td>
                  <td>{asset.target || '-'}</td>
                  <td>{asset.tls_version || '-'}</td>
                  <td>{asset.cipher || '-'}</td>
                  <td>{asset.key_exchange || '-'}</td>
                  <td>{asset.signature || '-'}</td>
                  <td>{asset.issuer || '-'}</td>
                  <td>{asset.http_status_code ?? '-'}</td>
                  <td>{asset.quantum_safe === true ? 'Yes' : asset.quantum_safe === false ? 'No' : 'Unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default function ScanDetailsPage() {
  const { id } = useParams();
  const location = useLocation();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [cbomPayload, setCbomPayload] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [scanResponse, reportResponse, cbomResponse] = await Promise.all([
          scanApi.getScanById(id),
          reportApi.getReport(id),
          reportApi.getCbom(id),
        ]);
        const response = scanResponse;
        setPayload(response.data.data);
        setReportMarkdown(reportResponse.data?.data?.markdown || '');
        setCbomPayload(cbomResponse.data?.data || null);
      } catch (err) {
        setError(err.message || 'Unable to load scan details');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!location.hash) return;
    const targetId = location.hash.replace('#', '');
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.hash, payload]);

  function handleMetricClick(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (loading) return <Loader text="Loading scan details..." />;
  if (error) return <div className="error-banner">{error}</div>;
  if (!payload) return null;

  const { scan, assets, recommendation } = payload;

  return (
    <div className="page-stack">
      <div className="card">
        <div className="card-header spread">
          <div>
            <h2>Scan details</h2>
            <p>{scan.domain || scan.apiEndpoint || 'Composite scan'}</p>
          </div>
          <button className="btn btn-secondary" onClick={() => downloadJson(`scan-${scan._id}.json`, payload)}>
            Export JSON
          </button>
        </div>
      </div>

      <RiskCard score={scan.overallRiskScore} level={scan.riskLevel} summary={scan.summary} />
      <ChartsSection scan={scan} assets={assets} onMetricClick={handleMetricClick} />
      <AssetTable assets={assets} scan={scan} />

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Findings</h3>
            <p>Key risk signals captured by the backend.</p>
          </div>
        </div>
        <ul className="bullet-list" id="findings-section">
          {(scan.findings || []).map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>

        <h4 id="warnings-section">Warnings</h4>
        {scan.warnings?.length ? (
          <>
            <ul className="bullet-list warning-list">
              {scan.warnings.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty-state">No warnings for this scan.</div>
        )}
      </div>

      <RecommendationPanel
        recommendation={recommendation}
      />

      <div className="card" id="cbom-section">
        <div className="card-header spread">
          <div>
            <h3>CBOM Preview</h3>
            <p>Human-readable cryptographic inventory and scan context.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => downloadCbomPdf(scan, scan.cbom || {})}>
            Download CBOM
          </button>
        </div>
        <CbomOverview cbom={cbomPayload || scan.cbom} />
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Generated Report</h3>
            <p>Report output rendered as structured text.</p>
          </div>
        </div>
        {reportMarkdown ? (
          <div className="report-prose">
            <ReactMarkdown>{reportMarkdown}</ReactMarkdown>
          </div>
        ) : (
          <div className="empty-state">No report output available.</div>
        )}
      </div>
    </div>
  );
}
