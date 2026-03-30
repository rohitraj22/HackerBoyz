export default function RiskCard({ score = 0, level = 'Low', summary = '' }) {
  const normalizedScore = Math.max(0, Math.min(100, Number(score) || 0));

  return (
    <div className="card risk-card" style={{ '--score-deg': `${(normalizedScore / 100) * 360}deg` }}>
      <div className="risk-score-ring">
        <div className="risk-score-value">{normalizedScore}</div>
        <div className="risk-score-label">/100</div>
      </div>
      <div className="risk-content">
        <span className={`badge badge-${level.toLowerCase()}`}>{level}</span>
        <h3>Security score</h3>
        <p className="risk-caption">0 = unsafe, 100 = safest</p>
        <p>{summary}</p>
      </div>
    </div>
  );
}
