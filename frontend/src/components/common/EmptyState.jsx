export default function EmptyState({
  title = 'Nothing to show yet',
  description = 'Run a scan to populate this section.'
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
