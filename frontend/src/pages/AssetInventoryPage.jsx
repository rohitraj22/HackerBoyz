import { useEffect, useMemo, useState } from 'react';
import { inventoryApi } from '../api/inventoryApi';

const typeOptions = [
  { key: 'domain', label: 'Domains' },
  { key: 'certificate', label: 'SSL Certificates' },
  { key: 'ip', label: 'IP / Subnets' },
  { key: 'software', label: 'Software' },
];

const statusOptions = ['all', 'new', 'false_positive', 'confirmed', 'resolved'];

function getColumns(type) {
  if (type === 'domain') {
    return ['name', 'registrar', 'registrationDate', 'status', 'lastSeenAt'];
  }
  if (type === 'certificate') {
    return ['commonName', 'certificateAuthority', 'tlsVersion', 'keyLength', 'validTo', 'status'];
  }
  if (type === 'ip') {
    return ['ipAddress', 'subnet', 'port', 'location', 'companyName', 'status'];
  }
  return ['softwareName', 'softwareVersion', 'host', 'port', 'owner', 'status'];
}

function formatCell(asset, key) {
  return (
    asset?.[key] ??
    asset?.metadata?.[key] ??
    asset?.name ??
    asset?.hostname ??
    '-'
  );
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
  return String(value);
}

function AssetDetailsView({ asset }) {
  if (!asset) {
    return <div className="empty-state">Select an asset to view full details.</div>;
  }

  const identityFields = [
    ['ID', asset._id],
    ['Asset Type', asset.assetType || asset.type],
    ['Status', asset.status],
    ['Name', asset.name],
    ['Target', asset.target],
    ['Hostname', asset.hostname],
    ['Domain', asset.domain],
  ];

  const networkFields = [
    ['URL', asset.url],
    ['IP Address', asset.ipAddress],
    ['Subnet', asset.subnet],
    ['Port', asset.port],
    ['API Path', asset.apiPath],
    ['Is API', asset.isApi],
    ['Owner', asset.owner],
  ];

  const certFields = [
    ['Common Name', asset.commonName],
    ['Certificate Authority', asset.certificateAuthority],
    ['TLS Version', asset.tlsVersion],
    ['Cipher', asset.cipher],
    ['Key Exchange', asset.keyExchange],
    ['Signature', asset.signature],
    ['Issuer', asset.issuer],
    ['Valid From', asset.validFrom],
    ['Valid To', asset.validTo],
    ['Expires At', asset.expiresAt],
  ];

  const softwareFields = [
    ['Software Name', asset.softwareName],
    ['Software Version', asset.softwareVersion],
    ['Product', asset.product],
  ];

  const Section = ({ title, fields }) => (
    <div className="recommendation-section">
      <h4>{title}</h4>
      <div className="grid-2">
        {fields.map(([label, value]) => (
          <p key={label} style={{ margin: 0 }}>
            <strong>{label}:</strong> {displayValue(value)}
          </p>
        ))}
      </div>
    </div>
  );

  return (
    <div className="page-stack">
      <Section title="Identity" fields={identityFields} />
      <Section title="Network" fields={networkFields} />
      <Section title="Certificate & Crypto" fields={certFields} />
      <Section title="Software" fields={softwareFields} />
      {asset.metadata ? (
        <div className="recommendation-section">
          <h4>Raw Metadata</h4>
          <pre className="code-block">{JSON.stringify(asset.metadata, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

export default function AssetInventoryPage() {
  const [activeType, setActiveType] = useState('domain');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [statusUpdatingFor, setStatusUpdatingFor] = useState('');

  const columns = useMemo(() => getColumns(activeType), [activeType]);

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const res = await inventoryApi.getSummary();
        setSummary(res.data || {});
      } catch (err) {
        console.error(err);
      }
    };

    loadSummary();
  }, []);

  useEffect(() => {
    const loadAssets = async () => {
      try {
        setLoading(true);
        setError('');
        const params = new URLSearchParams();

        params.set('type', activeType);
        if (status !== 'all') params.set('status', status);
        if (search.trim()) params.set('q', search.trim());

        const res = await inventoryApi.listAssets(Object.fromEntries(params.entries()));
        setAssets(Array.isArray(res.data?.assets) ? res.data.assets : Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setError(err.message || 'Failed to load inventory');
        setAssets([]);
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, [activeType, status, search]);

  const refreshAssets = async () => {
    const params = { type: activeType };
    if (status !== 'all') params.status = status;
    if (search.trim()) params.q = search.trim();
    const res = await inventoryApi.listAssets(params);
    setAssets(Array.isArray(res.data?.assets) ? res.data.assets : []);
  };

  const handleStatusUpdate = async (assetId, newStatus) => {
    try {
      setStatusUpdatingFor(assetId);
      await inventoryApi.updateAssetStatus(assetId, newStatus);
      await refreshAssets();
      if (selectedAsset?._id === assetId) {
        const detailRes = await inventoryApi.getAssetById(assetId);
        setSelectedAsset(detailRes.data || null);
      }
    } catch (err) {
      setError(err.message || 'Failed to update status');
    } finally {
      setStatusUpdatingFor('');
    }
  };

  const handleViewAsset = async (assetId) => {
    try {
      setAssetLoading(true);
      const res = await inventoryApi.getAssetById(assetId);
      setSelectedAsset(res.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load asset details');
      setSelectedAsset(null);
    } finally {
      setAssetLoading(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Asset Inventory</h2>
            <p>Operational inventory for domains, certificates, IPs/subnets and software.</p>
          </div>
        </div>

        <div className="grid-3">
          {typeOptions.map((type) => (
            <div className="stat-box" key={type.key}>
              <strong>{summary?.[type.key]?.count ?? 0}</strong>
              <span>{type.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-header spread">
          <div>
            <h3>Inventory Explorer</h3>
            <p>Filter by type, lifecycle status and search term.</p>
          </div>
        </div>

        <div className="form-actions">
          {typeOptions.map((type) => (
            <button
              key={type.key}
              className={`btn ${activeType === type.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveType(type.key)}
            >
              {type.label}
            </button>
          ))}
        </div>

        <div className="grid-3" style={{ marginTop: 18 }}>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {statusOptions.map((item) => (
                <option key={item} value={item}>
                  {item.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>

          <label>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search asset, host, domain, version..."
            />
          </label>

          <label>
            Current Type
            <input value={typeOptions.find((t) => t.key === activeType)?.label || ''} disabled />
          </label>
        </div>

        {error ? <div className="error-banner" style={{ marginTop: 16 }}>{error}</div> : null}

        {loading ? (
          <div className="loader-wrap" style={{ marginTop: 18 }}>
            <div className="loader" />
            <span>Loading inventory...</span>
          </div>
        ) : assets.length ? (
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table>
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset._id || asset.id}>
                    {columns.map((col) => (
                      <td key={col}>{formatCell(asset, col)}</td>
                    ))}
                    <td>
                      <div className="form-actions" style={{ marginTop: 0 }}>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          onClick={() => handleViewAsset(asset._id || asset.id)}
                        >
                          View
                        </button>
                        <select
                          value={asset.status || 'new'}
                          onChange={(e) => handleStatusUpdate(asset._id || asset.id, e.target.value)}
                          disabled={statusUpdatingFor === (asset._id || asset.id)}
                          style={{ minWidth: 130 }}
                        >
                          {statusOptions
                            .filter((item) => item !== 'all')
                            .map((item) => (
                              <option key={item} value={item}>
                                {item.replace('_', ' ')}
                              </option>
                            ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 18 }}>
            No assets found for the selected filters.
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>Asset Details</h3>
            <p>Detailed record from inventory asset endpoint.</p>
          </div>
        </div>

        {assetLoading ? (
          <div className="loader-wrap">
            <div className="loader" />
            <span>Loading asset details...</span>
          </div>
        ) : (
          <AssetDetailsView asset={selectedAsset} />
        )}
      </section>
    </div>
  );
}
