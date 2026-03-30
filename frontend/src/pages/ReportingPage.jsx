import { useEffect, useMemo, useState } from 'react';
import { reportingApi } from '../api/reportingApi';
import { formatDate } from '../utils/formatDate';

const REPORTING_TAB_ID = 'reporting';
const MODE_TABS = {
  executive: 'Executive Reporting',
  scheduled: 'Scheduled Reporting',
  'on-demand': 'On-Demand Reporting',
};

const SCHEDULE_SECTION_OPTIONS = [
  { key: 'discovery', label: 'Discovery' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'cbom', label: 'CBOM' },
  { key: 'pqc-posture', label: 'PQC Posture' },
  { key: 'cyber-rating', label: 'Cyber Rating' },
];

const SCHEDULE_ASSET_OPTIONS = [
  { value: 'all', label: 'All Assets' },
  { value: 'latest-scan', label: 'Latest Scan Assets' },
  { value: 'high-risk', label: 'High Risk Assets' },
];

const FIXED_TIMEZONE = 'Asia/Kolkata';

function createDefaultScheduleForm() {
  return {
    enableSchedule: true,
    name: 'Executive Summary Report',
    reportType: 'executive-summary',
    frequency: 'weekly',
    assetFilter: 'all',
    includedSections: ['discovery', 'inventory', 'cbom', 'pqc-posture', 'cyber-rating'],
    date: '',
    timeHour: '09',
    timeMinute: '00',
    timePeriod: 'AM',
    timezone: FIXED_TIMEZONE,
    enableEmail: true,
    email: 'executives@org.com',
    enableSavePath: true,
    savePath: '/Reports/Quarterly/',
  };
}

function parseEmailInput(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function createDefaultOnDemandForm() {
  return {
    reportType: 'executive-summary',
    enableEmail: false,
    email: '',
    enableSavePath: true,
    savePath: '/Reports/OnDemand/',
    includeDownloadLink: true,
    format: 'pdf',
    includeCharts: true,
    passwordProtect: false,
    reportPassword: '',
  };
}

function reportTypeLabel(value) {
  return String(value || '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getIstDateParts(dateInput) {
  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) {
    return {
      date: '',
      timeHour: '09',
      timeMinute: '00',
      timePeriod: 'AM',
    };
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FIXED_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(parsed);

  const values = Object.fromEntries(parts.filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    timeHour: values.hour || '09',
    timeMinute: values.minute || '00',
    timePeriod: String(values.dayPeriod || 'AM').toUpperCase() === 'PM' ? 'PM' : 'AM',
  };
}

function buildScheduleFormFromSaved(schedule) {
  const parts = getIstDateParts(schedule?.nextRunAt);
  const recipients = Array.isArray(schedule?.delivery?.email) ? schedule.delivery.email : [];
  const savePath = schedule?.delivery?.savePath || '';

  return {
    enableSchedule: Boolean(schedule?.isActive),
    name: schedule?.name || 'Executive Summary Report',
    reportType: schedule?.reportType || 'executive-summary',
    frequency: schedule?.frequency || 'weekly',
    assetFilter: schedule?.assetFilter || 'all',
    includedSections:
      Array.isArray(schedule?.includedSections) && schedule.includedSections.length
        ? schedule.includedSections
        : ['discovery', 'inventory', 'cbom', 'pqc-posture', 'cyber-rating'],
    date: parts.date,
    timeHour: parts.timeHour,
    timeMinute: parts.timeMinute,
    timePeriod: parts.timePeriod,
    timezone: FIXED_TIMEZONE,
    enableEmail: recipients.length > 0,
    email: recipients.join(', '),
    enableSavePath: Boolean(savePath),
    savePath,
  };
}

export default function ReportingPage() {
  const [generated, setGenerated] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [options, setOptions] = useState({ reportTypes: [], formats: [], frequencies: [] });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [generatingExecutive, setGeneratingExecutive] = useState(false);
  const [downloadingExecutive, setDownloadingExecutive] = useState(false);
  const [executiveReadyToDownload, setExecutiveReadyToDownload] = useState(false);
  const [generatedExecutiveReportId, setGeneratedExecutiveReportId] = useState('');
  const [executiveActionNotice, setExecutiveActionNotice] = useState('');
  const [executivePageSize, setExecutivePageSize] = useState(5);
  const [executivePage, setExecutivePage] = useState(1);
  const [onDemandPageSize, setOnDemandPageSize] = useState(5);
  const [onDemandPage, setOnDemandPage] = useState(1);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [onDemandNotice, setOnDemandNotice] = useState('');
  const [onDemandDownloadReportId, setOnDemandDownloadReportId] = useState('');
  const [editingScheduleId, setEditingScheduleId] = useState('');
  const [updatingScheduleId, setUpdatingScheduleId] = useState('');
  const [deletingScheduleId, setDeletingScheduleId] = useState('');
  const [generatingOnDemand, setGeneratingOnDemand] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(createDefaultScheduleForm());
  const [onDemandForm, setOnDemandForm] = useState(createDefaultOnDemandForm());

  const [openTabs, setOpenTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(REPORTING_TAB_ID);

  useEffect(() => {
    const load = async () => {
      try {
        const [generatedRes, optionsRes, scheduleRes] = await Promise.all([
          reportingApi.listGenerated(),
          reportingApi.getOptions(),
          reportingApi.listSchedules(),
        ]);

        setGenerated(Array.isArray(generatedRes.data?.reports) ? generatedRes.data.reports : []);
        setOptions({
          reportTypes: optionsRes.data?.reportTypes || [],
          formats: optionsRes.data?.formats || [],
          frequencies: optionsRes.data?.frequencies || [],
        });
        setSchedules(Array.isArray(scheduleRes.data?.schedules) ? scheduleRes.data.schedules : []);
      } catch (err) {
        setError(err.message || 'Failed to load reporting data');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (!message) return undefined;

    const timer = window.setTimeout(() => {
      setMessage('');
    }, 4000);

    const dismissOnScreenClick = () => {
      setMessage('');
    };

    window.addEventListener('pointerdown', dismissOnScreenClick);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', dismissOnScreenClick);
    };
  }, [message]);

  const activeSchedules = useMemo(
    () => schedules.filter((item) => Boolean(item?.isActive)),
    [schedules]
  );

  const nextSchedule = useMemo(() => {
    const items = schedules
      .filter((item) => item?.nextRunAt)
      .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
    return items[0] || null;
  }, [schedules]);

  const latestGenerated = useMemo(() => generated[0] || null, [generated]);

  useEffect(() => {
    if (!options.reportTypes?.length) return;
    if (options.reportTypes.includes(scheduleForm.reportType)) return;

    setScheduleForm((prev) => ({
      ...prev,
      reportType: options.reportTypes[0],
    }));
  }, [options.reportTypes, scheduleForm.reportType]);

  useEffect(() => {
    if (!options.reportTypes?.length) return;
    if (options.reportTypes.includes(onDemandForm.reportType)) return;

    setOnDemandForm((prev) => ({ ...prev, reportType: options.reportTypes[0] }));
  }, [options.reportTypes, onDemandForm.reportType]);

  useEffect(() => {
    if (!options.formats?.length) return;
    if (options.formats.includes(onDemandForm.format)) return;

    setOnDemandForm((prev) => ({ ...prev, format: options.formats[0] }));
  }, [options.formats, onDemandForm.format]);

  useEffect(() => {
    if (!onDemandForm.passwordProtect) return;
    if (onDemandForm.format === 'pdf') return;

    setOnDemandForm((prev) => ({ ...prev, format: 'pdf' }));
  }, [onDemandForm.passwordProtect, onDemandForm.format]);

  const openModeTab = (mode) => {
    if (!MODE_TABS[mode]) return;
    setOpenTabs((prev) => (prev.includes(mode) ? prev : [...prev, mode]));
    setActiveTab(mode);
  };

  const closeModeTab = (event, mode) => {
    event.stopPropagation();
    setOpenTabs((prev) => {
      const remaining = prev.filter((tab) => tab !== mode);
      if (activeTab === mode) {
        setActiveTab(remaining.length ? remaining[remaining.length - 1] : REPORTING_TAB_ID);
      }
      return remaining;
    });
  };

  const toggleScheduleActive = async (schedule) => {
    try {
      setError('');
      setUpdatingScheduleId(schedule._id);
      await reportingApi.updateSchedule(schedule._id, { isActive: !schedule.isActive });
      setSchedules((prev) =>
        prev.map((item) =>
          item._id === schedule._id ? { ...item, isActive: !item.isActive } : item
        )
      );
    } catch (err) {
      setError(err.message || 'Failed to update schedule status');
    } finally {
      setUpdatingScheduleId('');
    }
  };

  const startEditSchedule = (schedule) => {
    setEditingScheduleId(schedule._id);
    setScheduleForm(buildScheduleFormFromSaved(schedule));
    setScheduleNotice(`Editing schedule: ${schedule.name || schedule.reportType}`);
  };

  const cancelEditSchedule = () => {
    setEditingScheduleId('');
    setScheduleForm(createDefaultScheduleForm());
    setScheduleNotice('');
  };

  const deleteSchedule = async (schedule) => {
    try {
      setError('');
      setDeletingScheduleId(schedule._id);
      await reportingApi.deleteSchedule(schedule._id);
      setSchedules((prev) => prev.filter((item) => item._id !== schedule._id));

      if (editingScheduleId === schedule._id) {
        cancelEditSchedule();
      }
    } catch (err) {
      setError(err.message || 'Failed to delete schedule');
    } finally {
      setDeletingScheduleId('');
    }
  };

  const updateScheduleForm = (key, value) => {
    setScheduleForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateOnDemandForm = (key, value) => {
    setOnDemandForm((prev) => ({ ...prev, [key]: value }));
  };

  const to24HourTime = (hour12, minute, period) => {
    let hour = Number(hour12);
    if (period === 'AM') {
      if (hour === 12) hour = 0;
    } else if (hour < 12) {
      hour += 12;
    }
    return `${String(hour).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
  };

  const toIstScheduleDateTime = (date, hour12, minute, period) => {
    const hhmm = to24HourTime(hour12, minute, period);
    return `${date}T${hhmm}:00+05:30`;
  };

  const toggleScheduleSection = (sectionKey) => {
    setScheduleForm((prev) => ({
      ...prev,
      includedSections: prev.includedSections.includes(sectionKey)
        ? prev.includedSections.filter((item) => item !== sectionKey)
        : [...prev.includedSections, sectionKey],
    }));
  };

  const handleCreateOrUpdateSchedule = async (event) => {
    event.preventDefault();

    if (!scheduleForm.date) {
      setError('Please select a schedule date.');
      return;
    }

    try {
      setScheduling(true);
      setError('');
      setScheduleNotice('');

      const nextRunAt = toIstScheduleDateTime(
        scheduleForm.date,
        scheduleForm.timeHour,
        scheduleForm.timeMinute,
        scheduleForm.timePeriod
      );

      const payload = {
        name:
          scheduleForm.name?.trim() ||
          `${scheduleForm.frequency} ${String(scheduleForm.reportType).replace(/-/g, ' ')}`,
        reportType: scheduleForm.reportType,
        frequency: scheduleForm.frequency,
        timezone: FIXED_TIMEZONE,
        assetFilter: scheduleForm.assetFilter,
        includedSections: scheduleForm.includedSections,
        isActive: Boolean(scheduleForm.enableSchedule),
        delivery: {
          email: scheduleForm.enableEmail ? parseEmailInput(scheduleForm.email) : [],
          savePath:
            scheduleForm.enableSavePath && scheduleForm.savePath?.trim()
              ? scheduleForm.savePath.trim()
              : '',
          format: 'pdf',
        },
        nextRunAt,
      };

      if (editingScheduleId) {
        const res = await reportingApi.updateSchedule(editingScheduleId, payload);
        const updated = res.data?.schedule || null;
        if (updated) {
          setSchedules((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
        }
        setScheduleNotice('Schedule updated successfully.');
      } else {
        const res = await reportingApi.createSchedule(payload);
        const createdSchedule = res.data?.schedule || null;

        if (createdSchedule) {
          setSchedules((prev) => [createdSchedule, ...prev]);
        }
        setScheduleNotice('Scheduled report created successfully.');
      }

      setEditingScheduleId('');
      setScheduleForm(createDefaultScheduleForm());
    } catch (err) {
      setError(err.message || 'Failed to save scheduled report');
    } finally {
      setScheduling(false);
    }
  };

  const handleGenerateExecutive = async () => {
    try {
      setGeneratingExecutive(true);
      setError('');
      setMessage('');
      setExecutiveActionNotice('');

      const res = await reportingApi.generate({
        reportType: 'executive-summary',
        format: 'pdf',
        includeCharts: true,
        passwordProtect: false,
        assetScope: 'all',
        delivery: {},
      });

      if (res.data?.report) {
        setGenerated((prev) => [res.data.report, ...prev]);
        setGeneratedExecutiveReportId(res.data.report._id || '');
        setExecutiveReadyToDownload(true);
      }
      setExecutiveActionNotice('Generated. Ready to download.');
    } catch (err) {
      setError(err.message || 'Failed to generate executive report');
    } finally {
      setGeneratingExecutive(false);
    }
  };

  const executiveReports = generated.filter(
    (report) => String(report?.reportType || '').toLowerCase() === 'executive-summary'
  );
  const executiveTotalPages = Math.max(1, Math.ceil(executiveReports.length / executivePageSize));
  const executiveStartIndex = (executivePage - 1) * executivePageSize;
  const executivePageItems = executiveReports.slice(
    executiveStartIndex,
    executiveStartIndex + executivePageSize
  );
  const latestExecutiveReport = executiveReports[0] || null;
  const activeExecutiveSchedules = schedules.filter(
    (item) => item.isActive && String(item?.reportType || '').toLowerCase() === 'executive-summary'
  );
  const onDemandReports = generated;
  const onDemandTotalPages = Math.max(1, Math.ceil(onDemandReports.length / onDemandPageSize));
  const onDemandStartIndex = (onDemandPage - 1) * onDemandPageSize;
  const onDemandPageItems = onDemandReports.slice(
    onDemandStartIndex,
    onDemandStartIndex + onDemandPageSize
  );

  useEffect(() => {
    setExecutivePage(1);
  }, [executivePageSize]);

  useEffect(() => {
    if (executivePage > executiveTotalPages) {
      setExecutivePage(executiveTotalPages);
    }
  }, [executivePage, executiveTotalPages]);

  useEffect(() => {
    setOnDemandPage(1);
  }, [onDemandPageSize]);

  useEffect(() => {
    if (onDemandPage > onDemandTotalPages) {
      setOnDemandPage(onDemandTotalPages);
    }
  }, [onDemandPage, onDemandTotalPages]);

  const handleDownloadExecutive = async () => {
    const reportIdToDownload = generatedExecutiveReportId || latestExecutiveReport?._id;
    if (!reportIdToDownload) return;

    try {
      setDownloadingExecutive(true);
      setError('');
      setExecutiveActionNotice('');

      const response = await reportingApi.downloadGenerated(reportIdToDownload);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeType = String(latestExecutiveReport?.reportType || 'executive-report').replace(/[^a-z0-9-]/gi, '-').toLowerCase();

      anchor.href = downloadUrl;
      anchor.download = `${safeType}-${reportIdToDownload}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setExecutiveActionNotice('Downloaded.');
      setExecutiveReadyToDownload(false);
      setGeneratedExecutiveReportId('');
    } catch (err) {
      setError(err.message || 'Failed to download executive report');
    } finally {
      setDownloadingExecutive(false);
    }
  };

  const downloadReportById = async (report) => {
    try {
      const response = await reportingApi.downloadGenerated(report._id);
      const format = String(report?.format || 'pdf').toLowerCase();
      const mimeByFormat = {
        pdf: 'application/pdf',
        json: 'application/json',
        csv: 'text/csv',
      };

      const blob = new Blob([response.data], { type: mimeByFormat[format] || 'application/octet-stream' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeType = String(report?.reportType || 'report').replace(/[^a-z0-9-]/gi, '-').toLowerCase();

      anchor.href = downloadUrl;
      anchor.download = `${safeType}-${report._id}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err.message || 'Failed to download report');
    }
  };

  const handleGenerateOnDemand = async (event) => {
    event.preventDefault();

    const trimmedPassword = String(onDemandForm.reportPassword || '').trim();
    if (onDemandForm.passwordProtect && !trimmedPassword) {
      setError('Please enter a password for password-protected report.');
      return;
    }

    if (onDemandForm.passwordProtect && String(onDemandForm.format).toLowerCase() !== 'pdf') {
      setError('Password-protected reports are currently supported only for PDF format.');
      return;
    }

    try {
      setGeneratingOnDemand(true);
      setError('');
      setOnDemandNotice('');
      setOnDemandDownloadReportId('');

      const payload = {
        reportType: onDemandForm.reportType,
        format: onDemandForm.format,
        includeCharts: Boolean(onDemandForm.includeCharts),
        passwordProtect: Boolean(onDemandForm.passwordProtect),
        reportPassword: onDemandForm.passwordProtect ? trimmedPassword : '',
        assetScope: 'all',
        delivery: {
          email: onDemandForm.enableEmail ? parseEmailInput(onDemandForm.email) : [],
          savePath: onDemandForm.enableSavePath ? String(onDemandForm.savePath || '').trim() : '',
          downloadableLink: Boolean(onDemandForm.includeDownloadLink),
        },
      };

      const res = await reportingApi.generate(payload);
      const report = res.data?.report || null;

      if (report) {
        setGenerated((prev) => [report, ...prev]);
      }

      if (onDemandForm.includeDownloadLink && report?._id) {
        setOnDemandDownloadReportId(report._id);
      }

      setOnDemandNotice(res.data?.message || 'On-demand report generated successfully.');
    } catch (err) {
      setError(err.message || 'Failed to generate on-demand report');
    } finally {
      setGeneratingOnDemand(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="scan-browser card">
        <div className="scan-browser-tabs" role="tablist" aria-label="Reporting tabs">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === REPORTING_TAB_ID}
            className={`scan-browser-tab ${activeTab === REPORTING_TAB_ID ? 'active' : ''}`}
            onClick={() => setActiveTab(REPORTING_TAB_ID)}
          >
            Reporting
          </button>
          {openTabs.map((tab) => (
            <div key={tab} className={`scan-browser-tab-group ${activeTab === tab ? 'active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                className="scan-browser-tab"
                onClick={() => setActiveTab(tab)}
              >
                {MODE_TABS[tab]}
              </button>
              <button
                type="button"
                className="scan-browser-close"
                aria-label={`Close ${MODE_TABS[tab]}`}
                onClick={(event) => closeModeTab(event, tab)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {message ? <div className="empty-state">{message}</div> : null}

      {loading ? (
        <section className="card">
          <div className="loader-wrap">
            <div className="loader" />
            <span>Loading reporting data...</span>
          </div>
        </section>
      ) : null}

      {activeTab === REPORTING_TAB_ID ? (
        <>
          <section className="card reporting-hero">
            <div className="card-header">
              <div>
                <h2>Reporting</h2>
                <p>Central hub for executive, scheduled and on-demand report workflows.</p>
              </div>
            </div>
            <div className="reporting-mode-grid">
              <button type="button" className="reporting-mode-card reporting-mode-link" onClick={() => openModeTab('executive')}>
                <div className="reporting-mode-icon">EX</div>
                <h3>Executive Reporting</h3>
                <p>Board-ready summaries with risk highlights and key actions.</p>
              </button>
              <button type="button" className="reporting-mode-card reporting-mode-link" onClick={() => openModeTab('scheduled')}>
                <div className="reporting-mode-icon">SC</div>
                <h3>Scheduled Reporting</h3>
                <p>Recurring report delivery, frequency control and status tracking.</p>
              </button>
              <button type="button" className="reporting-mode-card reporting-mode-link" onClick={() => openModeTab('on-demand')}>
                <div className="reporting-mode-icon">OD</div>
                <h3>On-Demand Reporting</h3>
                <p>Generate immediate exports across available formats.</p>
              </button>
            </div>
          </section>

          <section className="grid-3 reporting-kpi-grid">
            <article className="card reporting-kpi-card reporting-operational-card">
              <h3>Operational Snapshot</h3>
              <div className="stats-grid">
                <div className="stat-box">
                  <strong>{schedules.length}</strong>
                  <span>Total Schedules</span>
                </div>
                <div className="stat-box">
                  <strong>{activeSchedules.length}</strong>
                  <span>Active Schedules</span>
                </div>
                <div className="stat-box">
                  <strong>{generated.length}</strong>
                  <span>Generated Reports</span>
                </div>
              </div>
              <p className="reporting-inline-note">
                Next Run: {nextSchedule ? `${nextSchedule.name || nextSchedule.reportType} at ${formatDate(nextSchedule.nextRunAt)}` : 'No upcoming run'}
              </p>
            </article>

            <article className="card reporting-kpi-card">
              <h3>Report Configuration</h3>
              <div className="reporting-capability-list">
                <p><strong>Report Types:</strong> {options.reportTypes.join(', ') || '-'}</p>
                <p><strong>Formats:</strong> {options.formats.join(', ') || '-'}</p>
                <p><strong>Frequencies:</strong> {options.frequencies.join(', ') || '-'}</p>
              </div>
            </article>

            <article className="card reporting-kpi-card">
              <h3>Latest Output</h3>
              {latestGenerated ? (
                <div className="reporting-capability-list">
                  <p><strong>Type:</strong> {latestGenerated.reportType || '-'}</p>
                  <p><strong>Format:</strong> {(latestGenerated.format || '-').toUpperCase()}</p>
                  <p><strong>Status:</strong> {latestGenerated.deliveryStatus || latestGenerated.status || '-'}</p>
                  <p><strong>Created:</strong> {formatDate(latestGenerated.createdAt)}</p>
                </div>
              ) : (
                <div className="empty-state">No generated reports yet.</div>
              )}
            </article>
          </section>
        </>
      ) : null}

      {activeTab === 'executive' ? (
        <section className="card">
          <div className="card-header">
            <div>
              <h3>Executive Reporting</h3>
              <p>Board-level rollup with latest executive report output.</p>
            </div>
            <div className="executive-action-panel">
              <button
                className="btn btn-primary executive-action-button"
                type="button"
                onClick={executiveReadyToDownload ? handleDownloadExecutive : handleGenerateExecutive}
                disabled={generatingExecutive || downloadingExecutive}
              >
                {executiveReadyToDownload
                  ? downloadingExecutive
                    ? 'Downloading...'
                    : 'Download Executive Report'
                  : generatingExecutive
                    ? 'Generating...'
                    : 'Generate Executive Report'}
              </button>
              <div className="executive-action-slot" aria-live="polite">
                {executiveActionNotice ? (
                  <p className="reporting-inline-note executive-action-notice visible">
                    {executiveActionNotice}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="grid-3">
            <div className="stat-box">
              <strong>{executiveReports.length}</strong>
              <span>Executive Reports</span>
            </div>
            <div className="stat-box">
              <strong>{activeExecutiveSchedules.length}</strong>
              <span>Active Executive Schedules</span>
            </div>
            <div className="stat-box">
              <strong>{latestExecutiveReport ? formatDate(latestExecutiveReport.createdAt) : '-'}</strong>
              <span>Latest Generated</span>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div>
                <h3>Latest Executive Summary</h3>
              </div>
            </div>
            {latestExecutiveReport ? (
              <div className="reporting-capability-list">
                <p>{latestExecutiveReport.aiExecutiveSummary || 'Summary not available for this report.'}</p>
                <p>
                  <strong>Report ID:</strong> {latestExecutiveReport._id || '-'}
                </p>
                <p>
                  <strong>Format:</strong> {(latestExecutiveReport.format || '-').toUpperCase()}
                </p>
                <p>
                  <strong>Status:</strong> {latestExecutiveReport.deliveryStatus || latestExecutiveReport.status || '-'}
                </p>
              </div>
            ) : (
              <div className="empty-state">No executive report available yet.</div>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div>
                <h3>Recent Executive Reports</h3>
                <p>Most recent executive report outputs.</p>
              </div>
              <div className="executive-reports-toolbar">
                <label htmlFor="executive-page-size">Rows</label>
                <select
                  id="executive-page-size"
                  value={executivePageSize}
                  onChange={(event) => setExecutivePageSize(Number(event.target.value))}
                  aria-label="Rows per page"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
              </div>
            </div>
            {executiveReports.length ? (
              <div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>Format</th>
                        <th>Status</th>
                        <th>Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executivePageItems.map((report, index) => (
                        <tr key={report._id || index}>
                          <td>{formatDate(report.createdAt)}</td>
                          <td>{(report.format || '-').toUpperCase()}</td>
                          <td>{report.deliveryStatus || report.status || '-'}</td>
                          <td>{report.aiExecutiveSummary || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="executive-pagination">
                  <span>
                    Showing {executiveStartIndex + 1}-{Math.min(executiveStartIndex + executivePageSize, executiveReports.length)} of {executiveReports.length}
                  </span>
                  <div className="executive-pagination-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setExecutivePage((prev) => Math.max(1, prev - 1))}
                      disabled={executivePage === 1}
                    >
                      Previous
                    </button>
                    <span>Page {executivePage} / {executiveTotalPages}</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setExecutivePage((prev) => Math.min(executiveTotalPages, prev + 1))}
                      disabled={executivePage === executiveTotalPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">No executive reports generated yet.</div>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'scheduled' ? (
        <section className="card scheduled-reporting-card">
          <div className="scheduled-builder-head">
            <div>
              <h3>Scheduled Reporting</h3>
              <p>Configure recurring schedules, timing and delivery preferences.</p>
            </div>
            <label className="scheduled-enable-toggle">
              <span>Enable Schedule</span>
              <input
                type="checkbox"
                checked={scheduleForm.enableSchedule}
                onChange={(event) => updateScheduleForm('enableSchedule', event.target.checked)}
              />
            </label>
          </div>

          {scheduleNotice ? <div className="empty-state">{scheduleNotice}</div> : null}

          <form className="scheduled-builder-grid" onSubmit={handleCreateOrUpdateSchedule}>
            <section className="scheduled-panel">
              {editingScheduleId ? (
                <div className="scheduled-editing-banner">
                  <span>Editing existing schedule</span>
                  <button type="button" className="btn btn-secondary" onClick={cancelEditSchedule}>
                    Cancel Edit
                  </button>
                </div>
              ) : null}

              <div className="scheduled-field">
                <label htmlFor="schedule-name">Schedule Name</label>
                <input
                  id="schedule-name"
                  value={scheduleForm.name}
                  onChange={(event) => updateScheduleForm('name', event.target.value)}
                  placeholder="Executive Summary Report"
                />
              </div>

              <div className="scheduled-field">
                <label htmlFor="schedule-report-type">Report Type</label>
                <select
                  id="schedule-report-type"
                  value={scheduleForm.reportType}
                  onChange={(event) => updateScheduleForm('reportType', event.target.value)}
                >
                  {(options.reportTypes.length ? options.reportTypes : ['executive-summary']).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="scheduled-field">
                <label htmlFor="schedule-frequency">Frequency</label>
                <select
                  id="schedule-frequency"
                  value={scheduleForm.frequency}
                  onChange={(event) => updateScheduleForm('frequency', event.target.value)}
                >
                  {(options.frequencies.length ? options.frequencies : ['daily', 'weekly', 'monthly']).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="scheduled-field">
                <label htmlFor="schedule-assets">Select Assets</label>
                <select
                  id="schedule-assets"
                  value={scheduleForm.assetFilter}
                  onChange={(event) => updateScheduleForm('assetFilter', event.target.value)}
                >
                  {SCHEDULE_ASSET_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="scheduled-sections-wrap">
                <h4>Include Sections</h4>
                <div className="scheduled-sections-grid">
                  {SCHEDULE_SECTION_OPTIONS.map((section) => (
                    <label key={section.key} className="scheduled-section-chip">
                      <input
                        type="checkbox"
                        checked={scheduleForm.includedSections.includes(section.key)}
                        onChange={() => toggleScheduleSection(section.key)}
                      />
                      <span>{section.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <section className="scheduled-panel">
              <h4>Schedule Details</h4>

              <div className="scheduled-field">
                <label htmlFor="schedule-date">Date</label>
                <input
                  id="schedule-date"
                  type="date"
                  value={scheduleForm.date}
                  onChange={(event) => updateScheduleForm('date', event.target.value)}
                  required
                />
              </div>

              <div className="scheduled-field">
                <label htmlFor="schedule-time">Time</label>
                <div className="scheduled-time-picker" id="schedule-time">
                  <select
                    value={scheduleForm.timeHour}
                    onChange={(event) => updateScheduleForm('timeHour', event.target.value)}
                    aria-label="Hour"
                  >
                    {Array.from({ length: 12 }).map((_, index) => {
                      const hour = String(index + 1).padStart(2, '0');
                      return (
                        <option key={hour} value={hour}>
                          {hour}
                        </option>
                      );
                    })}
                  </select>
                  <span className="scheduled-time-separator">:</span>
                  <select
                    value={scheduleForm.timeMinute}
                    onChange={(event) => updateScheduleForm('timeMinute', event.target.value)}
                    aria-label="Minute"
                  >
                    {Array.from({ length: 60 }).map((_, index) => {
                      const minute = String(index).padStart(2, '0');
                      return (
                        <option key={minute} value={minute}>
                          {minute}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    value={scheduleForm.timePeriod}
                    onChange={(event) => updateScheduleForm('timePeriod', event.target.value)}
                    aria-label="AM PM"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>

              <div className="scheduled-field">
                <label htmlFor="schedule-timezone">Time Zone</label>
                <div id="schedule-timezone" className="scheduled-timezone-display" aria-label="Timezone fixed to Asia Kolkata">
                  <span className="scheduled-timezone-tag">IST</span>
                  <span>{FIXED_TIMEZONE}</span>
                </div>
              </div>

              <h4>Delivery Options</h4>
              <div className="scheduled-delivery-grid">
                <div className={`scheduled-delivery-item ${scheduleForm.enableEmail ? 'is-enabled' : ''}`}>
                  <div className="scheduled-delivery-head">
                    <h5>Email Delivery</h5>
                    <button
                      type="button"
                      className={`scheduled-status-toggle scheduled-status-toggle-sm ${scheduleForm.enableEmail ? 'is-active' : ''}`}
                      aria-pressed={scheduleForm.enableEmail}
                      onClick={() => updateScheduleForm('enableEmail', !scheduleForm.enableEmail)}
                    >
                      <span className="scheduled-status-knob" />
                      <span className="scheduled-status-label">{scheduleForm.enableEmail ? 'On' : 'Off'}</span>
                    </button>
                  </div>
                  <div className="scheduled-field scheduled-delivery-input">
                    <input
                      type="text"
                      value={scheduleForm.email}
                      onChange={(event) => updateScheduleForm('email', event.target.value)}
                      placeholder="executives@org.com, soc@org.com"
                      disabled={!scheduleForm.enableEmail}
                    />
                  </div>
                </div>

                <div className={`scheduled-delivery-item ${scheduleForm.enableSavePath ? 'is-enabled' : ''}`}>
                  <div className="scheduled-delivery-head">
                    <h5>Save to Location</h5>
                    <button
                      type="button"
                      className={`scheduled-status-toggle scheduled-status-toggle-sm ${scheduleForm.enableSavePath ? 'is-active' : ''}`}
                      aria-pressed={scheduleForm.enableSavePath}
                      onClick={() => updateScheduleForm('enableSavePath', !scheduleForm.enableSavePath)}
                    >
                      <span className="scheduled-status-knob" />
                      <span className="scheduled-status-label">{scheduleForm.enableSavePath ? 'On' : 'Off'}</span>
                    </button>
                  </div>
                  <div className="scheduled-field scheduled-delivery-input">
                    <input
                      value={scheduleForm.savePath}
                      onChange={(event) => updateScheduleForm('savePath', event.target.value)}
                      placeholder="/Reports/Quarterly/"
                      disabled={!scheduleForm.enableSavePath}
                    />
                  </div>
                </div>
              </div>

              <button className="btn btn-primary scheduled-submit" type="submit" disabled={scheduling}>
                {scheduling ? 'Saving...' : editingScheduleId ? 'Update Schedule' : 'Schedule Report'}
              </button>
            </section>
          </form>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div>
                <h4>Saved Schedules</h4>
                <p>Manage recipients, activation status, and actions of existing schedules.</p>
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
                      <th>Recipient</th>
                      <th>Next Run</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <tr key={schedule._id}>
                        <td>{schedule.name || '-'}</td>
                        <td>{schedule.reportType || '-'}</td>
                        <td>{schedule.frequency || '-'}</td>
                        <td>
                          <span className="scheduled-recipient-cell">
                            {Array.isArray(schedule.delivery?.email) && schedule.delivery.email.length
                              ? schedule.delivery.email.join(', ')
                              : '-'}
                          </span>
                        </td>
                        <td>{formatDate(schedule.nextRunAt)}</td>
                        <td>
                          <button
                            type="button"
                            className={`scheduled-status-toggle ${schedule.isActive ? 'is-active' : ''}`}
                            aria-pressed={schedule.isActive}
                            disabled={updatingScheduleId === schedule._id}
                            onClick={() => toggleScheduleActive(schedule)}
                          >
                            <span className="scheduled-status-knob" />
                            <span className="scheduled-status-label">{schedule.isActive ? 'On' : 'Off'}</span>
                          </button>
                        </td>
                        <td>
                          <div className="scheduled-actions-cell">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => startEditSchedule(schedule)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              disabled={deletingScheduleId === schedule._id}
                              onClick={() => deleteSchedule(schedule)}
                            >
                              {deletingScheduleId === schedule._id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No report schedules created yet.</div>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'on-demand' ? (
        <section className="card">
          <div className="card-header">
            <div>
              <h3>On-Demand Reporting</h3>
              <p>Request reports as needed with delivery and advanced controls.</p>
            </div>
          </div>

          <form className="on-demand-shell" onSubmit={handleGenerateOnDemand}>
            <div className="on-demand-grid">
              <div className="on-demand-column">
                <div className="on-demand-panel">
                  <div className="scheduled-field">
                    <label htmlFor="on-demand-report-type">Report Type</label>
                    <select
                      id="on-demand-report-type"
                      value={onDemandForm.reportType}
                      onChange={(event) => updateOnDemandForm('reportType', event.target.value)}
                    >
                      {(options.reportTypes.length ? options.reportTypes : ['executive-summary']).map((item) => (
                        <option key={item} value={item}>
                          {reportTypeLabel(item)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="on-demand-advanced">
                  <h4>Advanced Settings</h4>

                  <div className="scheduled-field on-demand-format-field">
                    <label htmlFor="on-demand-format">File Format</label>
                    <select
                      id="on-demand-format"
                      value={onDemandForm.format}
                      onChange={(event) => updateOnDemandForm('format', event.target.value)}
                      disabled={onDemandForm.passwordProtect}
                    >
                      {(options.formats.length ? options.formats : ['pdf', 'json', 'csv']).map((item) => (
                        <option key={item} value={item}>
                          {String(item).toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="on-demand-advanced-controls">
                    <button
                      type="button"
                      className={`scheduled-status-toggle ${onDemandForm.includeCharts ? 'is-active' : ''}`}
                      aria-pressed={onDemandForm.includeCharts}
                      onClick={() => updateOnDemandForm('includeCharts', !onDemandForm.includeCharts)}
                    >
                      <span className="scheduled-status-knob" />
                      <span className="scheduled-status-label">Charts {onDemandForm.includeCharts ? 'On' : 'Off'}</span>
                    </button>

                    <button
                      type="button"
                      className={`scheduled-status-toggle ${onDemandForm.passwordProtect ? 'is-active' : ''}`}
                      aria-pressed={onDemandForm.passwordProtect}
                      onClick={() =>
                        setOnDemandForm((prev) => ({
                          ...prev,
                          passwordProtect: !prev.passwordProtect,
                          reportPassword: !prev.passwordProtect ? prev.reportPassword : '',
                        }))
                      }
                    >
                      <span className="scheduled-status-knob" />
                      <span className="scheduled-status-label">Password {onDemandForm.passwordProtect ? 'On' : 'Off'}</span>
                    </button>
                  </div>

                  <div className="on-demand-password-slot">
                    {onDemandForm.passwordProtect ? (
                      <div className="scheduled-field on-demand-password-field">
                        <label htmlFor="on-demand-password">Report Password</label>
                        <input
                          id="on-demand-password"
                          type="password"
                          value={onDemandForm.reportPassword}
                          onChange={(event) => updateOnDemandForm('reportPassword', event.target.value)}
                          placeholder="Enter password to open generated PDF"
                        />
                      </div>
                    ) : (
                      <div className="on-demand-password-placeholder" role="note">
                        Turn Password On to set a PDF access password.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="on-demand-panel">
                <h4>Delivery Options</h4>
                <div className="scheduled-delivery-grid">
                  <div className={`scheduled-delivery-item ${onDemandForm.enableEmail ? 'is-enabled' : ''}`}>
                    <div className="scheduled-delivery-head">
                      <h5>Send via Email</h5>
                      <button
                        type="button"
                        className={`scheduled-status-toggle scheduled-status-toggle-sm ${onDemandForm.enableEmail ? 'is-active' : ''}`}
                        aria-pressed={onDemandForm.enableEmail}
                        onClick={() => updateOnDemandForm('enableEmail', !onDemandForm.enableEmail)}
                      >
                        <span className="scheduled-status-knob" />
                        <span className="scheduled-status-label">{onDemandForm.enableEmail ? 'On' : 'Off'}</span>
                      </button>
                    </div>
                    <div className="scheduled-field scheduled-delivery-input">
                      <input
                        type="text"
                        value={onDemandForm.email}
                        onChange={(event) => updateOnDemandForm('email', event.target.value)}
                        placeholder="security@org.com, soc@org.com"
                        disabled={!onDemandForm.enableEmail}
                      />
                    </div>
                  </div>

                  <div className={`scheduled-delivery-item ${onDemandForm.enableSavePath ? 'is-enabled' : ''}`}>
                    <div className="scheduled-delivery-head">
                      <h5>Save to Location</h5>
                      <button
                        type="button"
                        className={`scheduled-status-toggle scheduled-status-toggle-sm ${onDemandForm.enableSavePath ? 'is-active' : ''}`}
                        aria-pressed={onDemandForm.enableSavePath}
                        onClick={() => updateOnDemandForm('enableSavePath', !onDemandForm.enableSavePath)}
                      >
                        <span className="scheduled-status-knob" />
                        <span className="scheduled-status-label">{onDemandForm.enableSavePath ? 'On' : 'Off'}</span>
                      </button>
                    </div>
                    <div className="scheduled-field scheduled-delivery-input">
                      <input
                        value={onDemandForm.savePath}
                        onChange={(event) => updateOnDemandForm('savePath', event.target.value)}
                        placeholder="/Reports/OnDemand/"
                        disabled={!onDemandForm.enableSavePath}
                      />
                    </div>
                  </div>

                  <div className={`scheduled-delivery-item ${onDemandForm.includeDownloadLink ? 'is-enabled' : ''}`}>
                    <div className="scheduled-delivery-head">
                      <h5>Expose Download Link</h5>
                      <button
                        type="button"
                        className={`scheduled-status-toggle scheduled-status-toggle-sm ${onDemandForm.includeDownloadLink ? 'is-active' : ''}`}
                        aria-pressed={onDemandForm.includeDownloadLink}
                        onClick={() => updateOnDemandForm('includeDownloadLink', !onDemandForm.includeDownloadLink)}
                      >
                        <span className="scheduled-status-knob" />
                        <span className="scheduled-status-label">{onDemandForm.includeDownloadLink ? 'On' : 'Off'}</span>
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            <div className="on-demand-form-footer">
              <button className="btn btn-primary on-demand-submit" type="submit" disabled={generatingOnDemand}>
                {generatingOnDemand ? 'Generating...' : 'Generate Report'}
              </button>
            </div>
          </form>

          {onDemandNotice ? (
            <div className="empty-state on-demand-notice">
              <span>{onDemandNotice}</span>
              {onDemandDownloadReportId ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const candidate = generated.find((item) => item?._id === onDemandDownloadReportId);
                    const fallback = {
                      _id: onDemandDownloadReportId,
                      format: onDemandForm.format,
                      reportType: onDemandForm.reportType,
                    };
                    downloadReportById(candidate || fallback);
                  }}
                >
                  Download Report
                </button>
              ) : null}
            </div>
          ) : (
            <div className="on-demand-notice-slot" />
          )}

          {generated.length ? (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Report Type</th>
                    <th>Format</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {onDemandPageItems.map((report, index) => (
                    <tr key={report._id || index}>
                      <td>{reportTypeLabel(report.reportType || '-')}</td>
                      <td>{String(report.format || '-').toUpperCase()}</td>
                      <td>{formatDate(report.createdAt)}</td>
                      <td>{report.deliveryStatus || report.status || '-'}</td>
                      <td>
                        <button type="button" className="btn btn-secondary" onClick={() => downloadReportById(report)}>
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="executive-pagination" style={{ padding: '10px 12px' }}>
                <span>
                  Showing {onDemandStartIndex + 1}-{Math.min(onDemandStartIndex + onDemandPageSize, onDemandReports.length)} of {onDemandReports.length}
                </span>
                <div className="executive-pagination-actions">
                  <label htmlFor="on-demand-page-size">Rows</label>
                  <select
                    id="on-demand-page-size"
                    value={onDemandPageSize}
                    onChange={(event) => setOnDemandPageSize(Number(event.target.value))}
                    aria-label="Rows per page"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setOnDemandPage((prev) => Math.max(1, prev - 1))}
                    disabled={onDemandPage === 1}
                  >
                    Previous
                  </button>
                  <span>Page {onDemandPage} / {onDemandTotalPages}</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setOnDemandPage((prev) => Math.min(onDemandTotalPages, prev + 1))}
                    disabled={onDemandPage === onDemandTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: 12 }}>No generated reports yet.</div>
          )}
        </section>
      ) : null}
    </div>
  );
}
