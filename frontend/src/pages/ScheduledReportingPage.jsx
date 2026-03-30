import { useState } from 'react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportingApi } from '../api/reportingApi';
import { formatDate } from '../utils/formatDate';

const initialForm = {
  name: '',
  reportType: 'executive-summary',
  frequency: 'weekly',
  timezone: 'Asia/Kolkata',
  assets: 'all',
  includedSections: ['discovery', 'inventory', 'cbom'],
  email: '',
  savePath: '',
  nextRunAt: '',
};

export default function ScheduledReportingPage() {
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [options, setOptions] = useState({ reportTypes: [] });

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [scheduleRes, optionsRes] = await Promise.all([
          reportingApi.listSchedules(),
          reportingApi.getOptions(),
        ]);
        setSchedules(Array.isArray(scheduleRes.data?.schedules) ? scheduleRes.data.schedules : []);
        setOptions({ reportTypes: optionsRes.data?.reportTypes || [] });
      } catch (err) {
        setError(err.message || 'Failed to load reporting schedule data');
      }
    };

    loadInitial();
  }, []);

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSection = (section) => {
    setForm((prev) => ({
      ...prev,
      includedSections: prev.includedSections.includes(section)
        ? prev.includedSections.filter((item) => item !== section)
        : [...prev.includedSections, section],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError('');
      setMessage('');

      const res = await reportingApi.createSchedule({
        name: form.name,
        reportType: form.reportType,
        frequency: form.frequency,
        timezone: form.timezone,
        assetFilter: form.assets,
        includedSections: form.includedSections,
        delivery: {
          email: form.email ? [form.email] : [],
          savePath: form.savePath,
        },
        nextRunAt: form.nextRunAt,
      });

      if (res.data?.schedule) {
        setSchedules((prev) => [res.data.schedule, ...prev]);
      }
      setMessage('Scheduled report saved successfully.');
      setForm(initialForm);
    } catch (err) {
      setError(err.message || 'Failed to save scheduled report');
    } finally {
      setLoading(false);
    }
  };

  const toggleScheduleActive = async (schedule) => {
    try {
      setError('');
      await reportingApi.updateSchedule(schedule._id, { isActive: !schedule.isActive });
      setSchedules((prev) =>
        prev.map((item) =>
          item._id === schedule._id ? { ...item, isActive: !item.isActive } : item
        )
      );
    } catch (err) {
      setError(err.message || 'Failed to update schedule');
    }
  };

  return (
    <div className="page-stack">
      <section className="card">
        <div className="reporting-tabs">
          <Link to="/reporting/executive" className="reporting-tab">Executive</Link>
          <Link to="/reporting/scheduled" className="reporting-tab active">Scheduled</Link>
          <Link to="/reporting/on-demand" className="reporting-tab">On-Demand</Link>
        </div>

        <div className="card-header">
          <div>
            <h2>Scheduled Reporting</h2>
            <p>Create recurring reporting workflows with delivery options.</p>
          </div>
        </div>

        {message ? <div className="empty-state">{message}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}

        <form onSubmit={handleSubmit} className="page-stack">
          <div className="grid-2">
            <label>
              Schedule Name
              <input
                value={form.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Weekly Enterprise Summary"
                required
              />
            </label>

            <label>
              Report Type
              <select
                value={form.reportType}
                onChange={(e) => handleChange('reportType', e.target.value)}
              >
                {(options.reportTypes.length
                  ? options.reportTypes
                  : ['executive-summary', 'asset-inventory', 'cbom', 'pqc-posture', 'cyber-rating']
                ).map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid-2">
            <label>
              Frequency
              <select
                value={form.frequency}
                onChange={(e) => handleChange('frequency', e.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>

            <label>
              Timezone
              <input
                value={form.timezone}
                onChange={(e) => handleChange('timezone', e.target.value)}
              />
            </label>
          </div>

          <div className="grid-2">
            <label>
              Asset Scope
              <select
                value={form.assets}
                onChange={(e) => handleChange('assets', e.target.value)}
              >
                <option value="all">All Assets</option>
                <option value="critical-only">Critical Only</option>
                <option value="legacy-only">Legacy Only</option>
                <option value="public-facing">Public Facing Only</option>
              </select>
            </label>

            <label>
              Next Run
              <input
                type="datetime-local"
                value={form.nextRunAt}
                onChange={(e) => handleChange('nextRunAt', e.target.value)}
                required
              />
            </label>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3>Included Sections</h3>
              </div>
            </div>

            <div className="form-actions">
              {['discovery', 'inventory', 'cbom', 'pqc-posture', 'cyber-rating'].map((section) => (
                <button
                  type="button"
                  key={section}
                  className={`btn ${
                    form.includedSections.includes(section) ? 'btn-primary' : 'btn-secondary'
                  }`}
                  onClick={() => toggleSection(section)}
                >
                  {section}
                </button>
              ))}
            </div>
          </div>

          <div className="grid-2">
            <label>
              Email Delivery
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="security-team@example.com"
              />
            </label>

            <label>
              Save Location
              <input
                value={form.savePath}
                onChange={(e) => handleChange('savePath', e.target.value)}
                placeholder="/reports/quarterly"
              />
            </label>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Saving schedule...' : 'Save Schedule'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>Saved Schedules</h3>
            <p>Update activation state of existing schedules.</p>
          </div>
        </div>

        {schedules.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Frequency</th>
                  <th>Next Run</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule._id}>
                    <td>{schedule.name || '-'}</td>
                    <td>{schedule.reportType || '-'}</td>
                    <td>{schedule.frequency || '-'}</td>
                    <td>{formatDate(schedule.nextRunAt)}</td>
                    <td>
                      <button
                        type="button"
                        className={`btn ${schedule.isActive ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => toggleScheduleActive(schedule)}
                      >
                        {schedule.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No schedules created yet.</div>
        )}
      </section>
    </div>
  );
}