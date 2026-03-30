import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { reportingApi } from '../api/reportingApi';

const initialForm = {
  reportType: 'executive-summary',
  format: 'pdf',
  includeCharts: true,
  passwordProtect: false,
  assetScope: 'all',
  email: '',
  savePath: '',
};

export default function OnDemandReportingPage() {
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [options, setOptions] = useState({ reportTypes: [], formats: [] });

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const res = await reportingApi.getOptions();
        setOptions({
          reportTypes: res.data?.reportTypes || [],
          formats: res.data?.formats || [],
        });
      } catch (err) {
        setError(err.message || 'Failed to load reporting options');
      }
    };

    loadOptions();
  }, []);

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleGenerate = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError('');
      setResult(null);

      const res = await reportingApi.generate({
        reportType: form.reportType,
        format: form.format,
        includeCharts: form.includeCharts,
        passwordProtect: form.passwordProtect,
        assetScope: form.assetScope,
        delivery: {
          email: form.email ? [form.email] : [],
          savePath: form.savePath,
        },
      });
      const report = res.data?.report || null;
      const normalizedDownloadUrl = report?._id
        ? reportingApi.getDownloadUrl(report._id, res.data?.downloadUrl)
        : '';

      setResult({
        ...(res.data || { message: 'Report generated successfully.' }),
        downloadUrl: normalizedDownloadUrl,
      });
    } catch (err) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadGenerated = async () => {
    const reportId = result?.report?._id;
    if (!reportId) return;

    try {
      const response = await reportingApi.downloadGenerated(reportId);
      const format = String(result?.report?.format || 'pdf').toLowerCase();
      const mimeByFormat = {
        pdf: 'application/pdf',
        json: 'application/json',
        csv: 'text/csv',
      };
      const blob = new Blob([response.data], { type: mimeByFormat[format] || 'application/octet-stream' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeType = String(result?.report?.reportType || 'report').replace(/[^a-z0-9-]/gi, '-').toLowerCase();

      anchor.href = downloadUrl;
      anchor.download = `${safeType}-${reportId}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err.message || 'Failed to download generated report');
    }
  };

  return (
    <div className="page-stack">
      <section className="card">
        <div className="reporting-tabs">
          <Link to="/reporting/executive" className="reporting-tab">Executive</Link>
          <Link to="/reporting/scheduled" className="reporting-tab">Scheduled</Link>
          <Link to="/reporting/on-demand" className="reporting-tab active">On-Demand</Link>
        </div>

        <div className="card-header">
          <div>
            <h2>On-Demand Reporting</h2>
            <p>Generate reports instantly with selected format and delivery settings.</p>
          </div>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        {result ? (
          <div className="empty-state" style={{ marginBottom: 18 }}>
            {result.message || 'Report generated.'}
            {result.downloadUrl ? (
              <>
                {' '}
                <button type="button" className="btn btn-secondary" onClick={handleDownloadGenerated}>
                  Download generated report
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <form onSubmit={handleGenerate} className="page-stack">
          <div className="grid-2">
            <label>
              Report Type
              <select
                value={form.reportType}
                onChange={(e) => handleChange('reportType', e.target.value)}
              >
                {(options.reportTypes.length
                  ? options.reportTypes
                  : ['executive-summary', 'asset-discovery', 'asset-inventory', 'cbom', 'pqc-posture', 'cyber-rating']
                ).map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>

            <label>
              Format
              <select
                value={form.format}
                onChange={(e) => handleChange('format', e.target.value)}
              >
                {(options.formats.length ? options.formats : ['pdf', 'json', 'csv']).map((format) => (
                  <option key={format} value={format}>{format.toUpperCase()}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid-2">
            <label>
              Asset Scope
              <select
                value={form.assetScope}
                onChange={(e) => handleChange('assetScope', e.target.value)}
              >
                <option value="all">All Assets</option>
                <option value="critical-only">Critical Only</option>
                <option value="legacy-only">Legacy Only</option>
                <option value="latest-scan">Latest Scan Only</option>
              </select>
            </label>

            <label>
              Email Delivery
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="team@example.com"
              />
            </label>
          </div>

          <div className="grid-2">
            <label>
              Save Location
              <input
                value={form.savePath}
                onChange={(e) => handleChange('savePath', e.target.value)}
                placeholder="/reports/on-demand"
              />
            </label>

            <div className="card">
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={`btn ${form.includeCharts ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleChange('includeCharts', !form.includeCharts)}
                >
                  {form.includeCharts ? 'Charts Included' : 'Include Charts'}
                </button>

                <button
                  type="button"
                  className={`btn ${form.passwordProtect ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleChange('passwordProtect', !form.passwordProtect)}
                >
                  {form.passwordProtect ? 'Password Protected' : 'Password Protect'}
                </button>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}