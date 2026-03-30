import EmptyState from '../common/EmptyState';

export default function ChartsSection({ scan, assets = [], onMetricClick }) {
  if (!scan) {
    return <EmptyState title="No metrics yet" description="Run a scan to visualize posture metrics." />;
  }

  const securityScore = Math.max(0, Math.min(100, Number(scan.overallRiskScore) || 0));
  const riskExposure = 100 - securityScore;

  const bars = [
    { label: 'Security Score', value: securityScore, max: 100, display: `${securityScore}/100` },
    { label: 'Risk Exposure', value: riskExposure, max: 100, display: `${riskExposure}/100` },
    {
      label: 'Findings Density',
      value: Math.min((scan.findings?.length || 0) * 8, 100),
      max: 100,
      display: `${Math.min((scan.findings?.length || 0) * 8, 100)}/100 (${scan.findings?.length || 0} findings)`,
      jumpTo: 'findings-section',
    },
    {
      label: 'Warning Density',
      value: Math.min((scan.warnings?.length || 0) * 10, 100),
      max: 100,
      display: `${Math.min((scan.warnings?.length || 0) * 10, 100)}/100 (${scan.warnings?.length || 0} warnings)`,
      jumpTo: 'warnings-section',
    }
  ];

  return (
    <div className="card metrics-card">
      <div className="card-header">
        <div>
          <h3>Scan metrics</h3>
          <p>Normalized metrics where security score uses 0 unsafe and 100 safest.</p>
        </div>
      </div>

      <div className="bars">
        {bars.map((bar) => (
          <div className="bar-row" key={bar.label}>
            <span className="bar-label">{bar.label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(bar.value / bar.max) * 100}%` }} />
            </div>
            {bar.jumpTo && typeof onMetricClick === 'function' ? (
              <button
                type="button"
                className="bar-value bar-value-btn"
                onClick={() => onMetricClick(bar.jumpTo)}
                title={`Go to ${bar.label.toLowerCase()}`}
              >
                {bar.display || bar.value}
              </button>
            ) : (
              <strong className="bar-value">{bar.display || bar.value}</strong>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
