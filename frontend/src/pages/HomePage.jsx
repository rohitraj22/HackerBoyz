import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { homeApi } from '../api/homeApi';
import { formatDate } from '../utils/formatDate';

const fallbackData = {
    kpis: {
        totalAssets: 0,
        publicWebApps: 0,
        apis: 0,
        servers: 0,
        expiringCertificates: 0,
        highRiskAssets: 0,
    },
    severityBreakdown: {
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
    },
    recentScans: [],
    topRecommendations: [],
    scoreTrend: [],
    aiSummary: 'No summary available yet.',
};

function StatCard({ label, value }) {
    return (
        <div className="stat-box">
            <strong>{value ?? 0}</strong>
            <span>{label}</span>
        </div>
    );
}

export default function HomePage() {
    const [data, setData] = useState(fallbackData);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const loadSummary = async () => {
            try {
                const res = await homeApi.getSummary();
                setData({ ...fallbackData, ...(res.data || {}) });
            } catch (err) {
                setError(err.message || 'Failed to load home summary');
            } finally {
                setLoading(false);
            }
        };

        loadSummary();
    }, []);

    if (loading) {
        return (
            <div className="page-stack">
                <div className="card">
                    <div className="loader-wrap">
                        <div className="loader" />
                        <span>Loading home dashboard...</span>
                    </div>
                </div>
            </div>
        );
    }

    const averageScore = Number.isFinite(Number(data.kpis.averageScore))
        ? Math.max(0, Math.min(100, Number(data.kpis.averageScore)))
        : 0;
    const scoreDeg = averageScore * 3.6;

    return (
        <div className="page-stack">
            <section className="card">
                <div className="card-header">
                    <div>
                        <h2>Home</h2>
                        <p>Enterprise-wide overview of assets, posture, rating and latest recommendations.</p>
                    </div>
                </div>

                {error ? <div className="error-banner">{error}</div> : null}

                <div className="stats-grid">
                    <StatCard label="Total Assets" value={data.kpis.totalAssets} />
                    <StatCard label="Public Web Apps" value={data.kpis.publicWebApps} />
                    <StatCard label="APIs" value={data.kpis.apis} />
                    <StatCard label="Servers" value={data.kpis.servers} />
                    <StatCard label="Expiring Certs" value={data.kpis.expiringCertificates} />
                </div>
            </section>

            <section className="grid-2">
                <div className="card risk-card">
                    <div
                        className="risk-score-ring"
                        style={{ '--score-deg': `${scoreDeg}deg` }}
                    >
                        <div>
                            <div className="risk-score-value">
                                {Math.round(averageScore)}
                            </div>
                            <div className="risk-score-label">Avg /100</div>
                        </div>
                    </div>

                    <div className="risk-content">
                        <span className="badge home-risk-badge">Risk Overview</span>
                        <h3>Score & Severity Breakdown</h3>
                        <p className="risk-caption">Total scans: {data.kpis.totalScans ?? 0}</p>
                        <div className="risk-severity-grid">
                            <div className="risk-severity-item risk-critical">
                                <span>Critical</span>
                                <strong>{data.severityBreakdown.critical}</strong>
                            </div>
                            <div className="risk-severity-item risk-high">
                                <span>High</span>
                                <strong>{data.severityBreakdown.high}</strong>
                            </div>
                            <div className="risk-severity-item risk-moderate">
                                <span>Moderate</span>
                                <strong>{data.severityBreakdown.moderate}</strong>
                            </div>
                            <div className="risk-severity-item risk-low">
                                <span>Low</span>
                                <strong>{data.severityBreakdown.low}</strong>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <div>
                            <h3>Summary</h3>
                            <p>Generated from latest scan, findings and score movement.</p>
                        </div>
                    </div>

                    <p className="recommendation-summary">{data.aiSummary}</p>
                </div>
            </section>

            <section className="card">
                <div className="card-header">
                    <div>
                        <h3>Recent Scans</h3>
                        <p>Most recent scans with status and score changes.</p>
                    </div>
                </div>

                {data.recentScans.length ? (
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Started</th>
                                    <th>Status</th>
                                    <th>Score</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentScans.map((scan) => (
                                    <tr key={scan._id || scan.id}>
                                        <td>
                                            <Link to={`/scans/${scan._id || scan.id}#cbom-section`}>
                                                {scan.name || scan.target || scan.domain || scan.apiEndpoint || 'Unnamed scan'}
                                            </Link>
                                        </td>
                                        <td>{formatDate(scan.startedAt || scan.createdAt)}</td>
                                        <td>{scan.status || '-'}</td>
                                        <td>{scan.overallRiskScore ?? '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="empty-state">No recent scans available yet.</div>
                )}
            </section>
        </div>
    );
}