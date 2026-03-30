import { Link } from 'react-router-dom';
import { formatDate } from '../../utils/formatDate';
import EmptyState from '../common/EmptyState';

export default function TimelineHistory({ scans = [], onSelectScan, loadingScanId = '' }) {
  if (!scans.length) {
    return <EmptyState title="No history available" description="Past scans will appear here." />;
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Recent history</h3>
          <p>Latest scan activity from the database.</p>
        </div>
      </div>

      <div className="timeline">
        {scans.slice(0, 6).map((scan) => (
          onSelectScan ? (
            <button
              type="button"
              className="timeline-item timeline-item-btn"
              key={scan._id}
              onClick={() => onSelectScan(scan._id)}
            >
              <div className={`timeline-dot timeline-${scan.riskLevel?.toLowerCase()}`} />
              <div>
                <strong>{scan.domain || scan.apiEndpoint || 'Untitled scan'}</strong>
                <p>{scan.summary}</p>
                <span>
                  {loadingScanId === scan._id ? 'Opening tab...' : formatDate(scan.createdAt)}
                </span>
              </div>
            </button>
          ) : (
            <Link className="timeline-item" key={scan._id} to={`/scans/${scan._id}`}>
              <div className={`timeline-dot timeline-${scan.riskLevel?.toLowerCase()}`} />
              <div>
                <strong>{scan.domain || scan.apiEndpoint || 'Untitled scan'}</strong>
                <p>{scan.summary}</p>
                <span>{formatDate(scan.createdAt)}</span>
              </div>
            </Link>
          )
        ))}
      </div>
    </div>
  );
}
