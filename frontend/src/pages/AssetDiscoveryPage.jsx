import { useEffect, useState } from 'react';
import { discoveryApi } from '../api/discoveryApi';

export default function AssetDiscoveryPage() {
    const [mode, setMode] = useState('graph');
    const [graphData, setGraphData] = useState({ nodes: [], edges: [], highlights: [] });
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [searchResults, setSearchResults] = useState([]);
    const [loadingGraph, setLoadingGraph] = useState(false);
    const [loadingSearch, setLoadingSearch] = useState(false);
    const [error, setError] = useState('');
    const [targetType, setTargetType] = useState('domain');
    const [targetValue, setTargetValue] = useState('');
    const [discoveryLoading, setDiscoveryLoading] = useState(false);
    const [discoveryResult, setDiscoveryResult] = useState(null);
    const [relatedAssets, setRelatedAssets] = useState([]);
    const [relatedRelations, setRelatedRelations] = useState([]);
    const [relatedLoading, setRelatedLoading] = useState(false);

    useEffect(() => {
        const loadGraph = async () => {
            try {
                setLoadingGraph(true);
                const res = await discoveryApi.getGraph('latest');

                setGraphData({
                    nodes: res.data?.nodes || [],
                    edges: res.data?.edges || [],
                    highlights: res.data?.highlights || [],
                });
            } catch (err) {
                setError(err.message || 'Failed to load discovery graph');
            } finally {
                setLoadingGraph(false);
            }
        };

        loadGraph();
    }, []);

    const handleRunDiscovery = async (e) => {
        e.preventDefault();

        try {
            setDiscoveryLoading(true);
            setError('');
            setDiscoveryResult(null);

            const payload = {
                targetType,
                target: targetValue,
            };

            const res = await discoveryApi.run(payload);

            setDiscoveryResult(res.data);

            if (!res.data?.alreadyExists) {
                const graphRes = await discoveryApi.getGraph('latest');
                setGraphData({
                    nodes: graphRes.data?.nodes || [],
                    edges: graphRes.data?.edges || [],
                    highlights: graphRes.data?.highlights || [],
                });
            }
        } catch (err) {
            setError(err.message || 'Discovery failed');
        } finally {
            setDiscoveryLoading(false);
        }
    };

    const handleSearch = async (e) => {
        e.preventDefault();

        const payload = {
            query: searchQuery,
            startDate: dateRange.start,
            endDate: dateRange.end,
        };

        try {
            setLoadingSearch(true);
            setError('');
            setRelatedAssets([]);
            setRelatedRelations([]);

            const res = await discoveryApi.search(payload);

            setSearchResults(res.data?.results || []);
        } catch (err) {
            setError(err.message || 'Discovery search failed');
            setSearchResults([]);
        } finally {
            setLoadingSearch(false);
        }
    };

    const handleLoadRelated = async (assetId) => {
        try {
            setRelatedLoading(true);
            const res = await discoveryApi.getRelatedAssets(assetId);
            setRelatedAssets(Array.isArray(res.data?.assets) ? res.data.assets : []);
            setRelatedRelations(Array.isArray(res.data?.relations) ? res.data.relations : []);
        } catch (err) {
            setError(err.message || 'Failed to load related assets');
            setRelatedAssets([]);
            setRelatedRelations([]);
        } finally {
            setRelatedLoading(false);
        }
    };

    return (
        <div className="page-stack">
            <section className="card">
                <div className="card-header">
                    <div>
                        <h2>Asset Discovery</h2>
                        <p>Explore discovered assets via graph view or natural-language search.</p>
                    </div>
                </div>

                <section className="card">
                    <div className="card-header">
                        <div>
                            <h3>Discover New Asset</h3>
                            <p>
                                If the asset is not already present in MongoDB, a new scan will run and the
                                discovered data will be stored for future use.
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleRunDiscovery} className="grid-3">
                        <label>
                            Target Type
                            <select value={targetType} onChange={(e) => setTargetType(e.target.value)}>
                                <option value="domain">Domain</option>
                                <option value="api">API</option>
                            </select>
                        </label>

                        <label>
                            Target
                            <input
                                value={targetValue}
                                onChange={(e) => setTargetValue(e.target.value)}
                                placeholder="google.com or https://api.example.com"
                                required
                            />
                        </label>

                        <div className="form-actions">
                            <button className="btn btn-primary" type="submit" disabled={discoveryLoading}>
                                {discoveryLoading ? 'Running Discovery...' : 'Run Discovery'}
                            </button>
                        </div>
                    </form>

                    {discoveryResult ? (
                        <div className="recommendation-section" style={{ marginTop: 18 }}>
                            <h4>Discovery Result</h4>
                            <p>{discoveryResult.message}</p>
                            <p>Already Exists: {discoveryResult.alreadyExists ? 'Yes' : 'No'}</p>
                            <p>
                                Discovered Assets:{' '}
                                {Array.isArray(discoveryResult.discoveredAssets)
                                    ? discoveryResult.discoveredAssets.length
                                    : 0}
                            </p>
                        </div>
                    ) : null}
                </section>

                <div className="form-actions">
                    <button
                        className={`btn ${mode === 'graph' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setMode('graph')}
                    >
                        Graph View
                    </button>
                    <button
                        className={`btn ${mode === 'search' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setMode('search')}
                    >
                        Search View
                    </button>
                </div>

                {error ? <div className="error-banner" style={{ marginTop: 16 }}>{error}</div> : null}
            </section>

            {mode === 'graph' ? (
                <section className="grid-2">
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h3>Discovery Graph Snapshot</h3>
                                <p>Domains, IPs, certificates and software relationships.</p>
                            </div>
                        </div>

                        {loadingGraph ? (
                            <div className="loader-wrap">
                                <div className="loader" />
                                <span>Loading graph...</span>
                            </div>
                        ) : (
                            <>
                                <div className="stats-grid">
                                    <div className="stat-box">
                                        <strong>{graphData.nodes.length}</strong>
                                        <span>Nodes</span>
                                    </div>
                                    <div className="stat-box">
                                        <strong>{graphData.edges.length}</strong>
                                        <span>Edges</span>
                                    </div>
                                    <div className="stat-box">
                                        <strong>{graphData.highlights.length}</strong>
                                        <span>Highlights</span>
                                    </div>
                                </div>

                                <div className="recommendation-section" style={{ marginTop: 18 }}>
                                    <h4>Graph Notes</h4>
                                    <ul className="bullet-list">
                                        <li>Use this API to back a graph library later.</li>
                                        <li>Nodes should represent domains, IPs, certs, APIs and software.</li>
                                        <li>Edges should represent relationships like resolves_to, uses_cert and hosts_service.</li>
                                    </ul>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h3>Highlighted Discovery Events</h3>
                                <p>Newly discovered or suspicious relationships.</p>
                            </div>
                        </div>

                        {graphData.highlights.length ? (
                            <div className="timeline">
                                {graphData.highlights.map((item, idx) => (
                                    <div key={item._id || idx} className="timeline-item">
                                        <div className={`timeline-dot timeline-${String(item.severity || 'moderate').toLowerCase()}`} />
                                        <div>
                                            <strong>{item.title || item.asset || 'Discovery event'}</strong>
                                            <p>{item.description || item.reason || '-'}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">No highlighted events yet.</div>
                        )}
                    </div>
                </section>
            ) : (
                <section className="card">
                    <div className="card-header">
                        <div>
                            <h3>Search Discovery</h3>
                            <p>Search by domain, URL, contact, IoC or other terms.</p>
                        </div>
                    </div>

                    <form onSubmit={handleSearch} className="grid-3">
                        <label>
                            Search Query
                            <input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="show new subdomains discovered this month"
                            />
                        </label>

                        <label>
                            Start Date
                            <input
                                type="date"
                                value={dateRange.start}
                                onChange={(e) => {
                                    setDateRange((prev) => ({ ...prev, start: e.target.value }));
                                }}
                            />
                        </label>

                        <label>
                            End Date
                            <input
                                type="date"
                                value={dateRange.end}
                                onChange={(e) => {
                                    setDateRange((prev) => ({ ...prev, end: e.target.value }));
                                }}
                            />
                        </label>

                        <div className="form-actions">
                            <button className="btn btn-primary" type="submit" disabled={loadingSearch}>
                                {loadingSearch ? 'Searching...' : 'Run Search'}
                            </button>
                        </div>
                    </form>

                    {searchResults.length ? (
                        <div className="table-wrap" style={{ marginTop: 18 }}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Type</th>
                                        <th>Name</th>
                                        <th>Match Reason</th>
                                        <th>Status</th>
                                        <th>Relations</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.map((item, index) => (
                                        <tr key={item._id || index}>
                                            <td>{item.assetType || item.type || '-'}</td>
                                            <td>{item.name || item.hostname || item.ipAddress || '-'}</td>
                                            <td>{item.reason || item.matchReason || '-'}</td>
                                            <td>{item.status || '-'}</td>
                                            <td>
                                                {item._id ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary"
                                                        onClick={() => handleLoadRelated(item._id)}
                                                    >
                                                        View Related
                                                    </button>
                                                ) : (
                                                    '-'
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="empty-state" style={{ marginTop: 18 }}>
                            No discovery search results yet.
                        </div>
                    )}

                    <div className="card" style={{ marginTop: 18 }}>
                        <div className="card-header">
                            <div>
                                <h4>Related Assets</h4>
                                <p>Relationship graph for a selected search result.</p>
                            </div>
                        </div>

                        {relatedLoading ? (
                            <div className="loader-wrap">
                                <div className="loader" />
                                <span>Loading related assets...</span>
                            </div>
                        ) : relatedAssets.length ? (
                            <div className="grid-2">
                                <div>
                                    <strong>Assets ({relatedAssets.length})</strong>
                                    <ul className="bullet-list">
                                        {relatedAssets.map((asset) => (
                                            <li key={asset._id}>{asset.name || asset.hostname || asset.domain || asset.ipAddress || asset.url || 'Asset'}</li>
                                        ))}
                                    </ul>
                                </div>
                                <div>
                                    <strong>Relations ({relatedRelations.length})</strong>
                                    <ul className="bullet-list">
                                        {relatedRelations.map((rel) => (
                                            <li key={rel._id}>{rel.relationType || 'related'} ({String(rel.confidence || 0)})</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        ) : (
                            <div className="empty-state">Choose a result and click "View Related".</div>
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}