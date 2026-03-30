import EmptyState from '../common/EmptyState';

function cleanMarkdownText(text = '') {
  return String(text)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .trim();
}

function Section({ title, items }) {
  return (
    <div className="recommendation-section">
      <h4>{title}</h4>
      <ul>
        {(items || []).map((item, index) => (
          <li key={`${title}-${index}`}>{cleanMarkdownText(item)}</li>
        ))}
      </ul>
    </div>
  );
}

export default function RecommendationPanel({
  recommendation
}) {
  if (!recommendation) {
    return <EmptyState title="No recommendations yet" description="Recommendations will appear after a successful scan." />;
  }

  return (
    <div className="card">
      <div className="card-header spread">
        <div>
          <h3>Recommended Actions</h3>
          <p>Executive summary and prioritized action plan.</p>
        </div>
      </div>

      <div className="recommendation-summary">
        <h4>Executive summary</h4>
        <p>{cleanMarkdownText(recommendation.executiveSummary)}</p>
      </div>

      <div className="grid-3">
        <Section title="Priority actions" items={recommendation.priorityActions} />
        <Section title="Migration plan" items={recommendation.migrationPlan} />
        <Section title="Technical recommendations" items={recommendation.technicalRecommendations} />
      </div>
    </div>
  );
}
