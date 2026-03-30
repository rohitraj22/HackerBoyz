import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { reportingApi } from '../api/reportingApi';
import { formatDate } from '../utils/formatDate';

export default function ExecutiveReportingPage() {
  const [reports, setReports] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [reportsRes, scheduleRes] = await Promise.all([
          reportingApi.listGenerated(),
          reportingApi.listSchedules(),
        ]);

        setReports(Array.isArray(reportsRes.data?.reports) ? reportsRes.data.reports : []);
        setSchedules(Array.isArray(scheduleRes.data?.schedules) ? scheduleRes.data.schedules : []);
      } catch (err) {
        setError(err.message || 'Failed to load executive reporting data');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const executiveReports = useMemo(
    () => reports.filter((report) => String(report.reportType || '').toLowerCase() === 'executive-summary'),
    [reports]
  );

  const executiveSchedules = useMemo(
    () => schedules.filter((schedule) => String(schedule.reportType || '').toLowerCase() === 'executive-summary'),
    [schedules]
  );

  const latestExecutive = executiveReports[0] || null;

  const handleGenerateExecutive = async () => {
    try {
      setGenerating(true);
      setError('');
      setMessage('');

      const res = await reportingApi.generate({
        reportType: 'executive-summary',
        format: 'pdf',
        includeCharts: true,
        passwordProtect: false,
        assetScope: 'all',
        delivery: {},
      });

      if (res.data?.report) {
        setReports((prev) => [res.data.report, ...prev]);
      }

      setMessage(res.data?.message || 'Executive report generated successfully.');
    } catch (err) {
      setError(err.message || 'Failed to generate executive report');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="card">
        <div className="reporting-tabs">
          <Link to="/reporting/executive" className="reporting-tab active">Executive</Link>
          <Link to="/reporting/scheduled" className="reporting-tab">Scheduled</Link>
          <Link to="/reporting/on-demand" className="reporting-tab">On-Demand</Link>
        </div>

        <div className="card-header">
          <div>
            <h2>Executive Reporting</h2>
            <p>Board-ready risk summary with latest delivery status and schedule coverage.</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={handleGenerateExecutive} disabled={generating}>
            {generating ? 'Generating...' : 'Generate Executive Report'}
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {message ? <div className="empty-state">{message}</div> : null}

        {loading ? (
          <div className="loader-wrap">
            <div className="loader" />
            <span>Loading executive reporting...</span>
          </div>
        ) : (
          <div className="grid-3">
            <div className="stat-box">
              <strong>{executiveReports.length}</strong>
              <span>Executive Reports</span>
            </div>
            <div className="stat-box">
              <strong>{executiveSchedules.filter((item) => item.isActive).length}</strong>
              <span>Active Executive Schedules</span>
            </div>
            <div className="stat-box">
              <strong>{latestExecutive ? formatDate(latestExecutive.createdAt) : '-'}</strong>
              <span>Latest Generated</span>
            </div>
          </div>
        )}
      </section>

      <section className="grid-2">
        <section className="card">
          <div className="card-header">
            <div>
              <h3>Latest Executive Summary</h3>
              <p>AI executive narrative from latest generated report.</p>
            </div>
          </div>

          {latestExecutive?.aiExecutiveSummary ? (
            <div className="report-prose">
              <p>{latestExecutive.aiExecutiveSummary}</p>
            </div>
          ) : (
            <div className="empty-state">No executive summary generated yet.</div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3>Executive Schedules</h3>
              <p>Configured recurring executive summary schedules.</p>
            </div>
          </div>

          {executiveSchedules.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Frequency</th>
                    <th>Next Run</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {executiveSchedules.map((item) => (
                    <tr key={item._id}>
                      <td>{item.name || '-'}</td>
                      <td>{item.frequency || '-'}</td>
                      <td>{formatDate(item.nextRunAt)}</td>
                      <td>{item.isActive ? 'Active' : 'Inactive'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">No executive schedules created yet.</div>
          )}
        </section>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>Executive Report History</h3>
            <p>Generated executive reports and delivery status.</p>
          </div>
        </div>

        {executiveReports.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Storage Path</th>
                </tr>
              </thead>
              <tbody>
                {executiveReports.map((report) => (
                  <tr key={report._id}>
                    <td>{String(report.format || '-').toUpperCase()}</td>
                    <td>{report.deliveryStatus || report.status || '-'}</td>
                    <td>{formatDate(report.createdAt)}</td>
                    <td>{report.storagePath || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No executive reports generated yet.</div>
        )}
      </section>
    </div>
  );
}
