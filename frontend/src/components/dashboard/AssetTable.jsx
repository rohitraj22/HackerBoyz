import EmptyState from '../common/EmptyState';
import { formatDate } from '../../utils/formatDate';

function splitCiphers(value) {
  const list = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(list)];
}

function pick(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '-';
}

function formatWhen(value) {
  if (!value) return '-';
  try {
    return formatDate(value);
  } catch {
    return String(value);
  }
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== '';
}

function hasDisplayValue(value) {
  return hasValue(value) && String(value).trim() !== '-';
}

function infoScore(asset = {}) {
  const directFields = [
    asset.name,
    asset.assetType,
    asset.target,
    asset.owner,
    asset.registrationDate,
    asset.registrar,
    asset.hostname,
    asset.domain,
    asset.url,
    asset.apiPath,
    asset.port,
    asset.subnet,
    asset.softwareVersion,
    asset.softwareName,
    asset.location,
    asset.netname,
    asset.commonName,
    asset.tlsVersion,
    asset.keyExchange,
    asset.signature,
    asset.cipher,
  ];

  let score = directFields.reduce((total, field) => total + (hasValue(field) ? 1 : 0), 0);

  const metadata = asset.metadata || {};
  const metadataFields = [
    metadata.registrationDate,
    metadata.registrar,
    metadata.companyName,
    metadata.organization,
    metadata.host,
    metadata.port,
    metadata.ports,
    metadata.version,
    metadata.tlsVersion,
    metadata.location,
    metadata.city,
    metadata.country,
    metadata.netname,
    metadata.isp,
    metadata.orgName,
    metadata.asn,
    metadata.subnet,
    metadata.fingerprint,
    metadata.sha256,
    metadata.certFingerprint,
    metadata.certificateFingerprint,
    metadata.statusCode,
    metadata.contentType,
    metadata.server,
    metadata.softwareType,
  ];

  score += metadataFields.reduce((total, field) => total + (hasValue(field) ? 1 : 0), 0);
  return score;
}

function getQuantumSafeStatus(assetQuantumSafe, scanScore) {
  if (assetQuantumSafe === true) return 'Yes';
  if (assetQuantumSafe === false) return 'No';

  const score = Number(scanScore);
  if (Number.isNaN(score)) return 'Unknown';
  if (score >= 75) return 'Yes';
  if (score >= 50) return 'Likely';
  return 'No';
}

export default function AssetTable({ assets = [], scan = null }) {
  if (!assets.length) {
    return <EmptyState title="No assets found" description="Run a scan and asset metadata will appear here." />;
  }

  const sortedAssets = [...assets].sort((a, b) => {
    const left = new Date(a?.createdAt || 0).getTime();
    const right = new Date(b?.createdAt || 0).getTime();
    return right - left;
  });

  const preferredAssets = sortedAssets.filter((item) => {
    const type = String(item?.assetType || '').toLowerCase();
    return type !== 'certificate' && type !== 'ip';
  });

  const candidateAssets = preferredAssets.length ? preferredAssets : sortedAssets;

  const asset = [...candidateAssets].sort((left, right) => {
    const scoreDiff = infoScore(right) - infoScore(left);
    if (scoreDiff !== 0) return scoreDiff;

    const leftTime = new Date(left?.createdAt || 0).getTime();
    const rightTime = new Date(right?.createdAt || 0).getTime();
    return rightTime - leftTime;
  })[0] || sortedAssets[0] || assets[assets.length - 1];

  const quantumSafeStatus = getQuantumSafeStatus(asset.quantumSafe, scan?.overallRiskScore);

  const sections = [
    {
      title: 'Identity',
      items: [
        ['Name', pick(asset.name)],
        ['Type', pick(asset.assetType)],
        ['Target', pick(asset.target)],
        ['Company Name', pick(asset.owner, asset.metadata?.companyName, asset.metadata?.organization)],
      ],
    },
    {
      title: 'Discovery',
      items: [
        ['Registration Date', formatWhen(pick(asset.registrationDate, asset.metadata?.registrationDate))],
        ['Registrar Company Name', pick(asset.registrar, asset.metadata?.registrar)],
        ['Host', pick(asset.hostname, asset.domain, asset.url, asset.metadata?.host)],
        ['URL', pick(asset.url)],
        ['API Path', pick(asset.apiPath)],
        ['Port', pick(asset.port, asset.metadata?.ports, asset.metadata?.port)],
        ['Subnet', pick(asset.subnet, asset.metadata?.subnet)],
        ['ASN', pick(asset.metadata?.asn, asset.metadata?.asnNumber)],
        ['Version', pick(asset.softwareVersion, asset.metadata?.version, asset.tlsVersion, asset.metadata?.tlsVersion)],
        ['Location', pick(asset.metadata?.location, asset.metadata?.country, asset.metadata?.city)],
        ['Netname', pick(asset.metadata?.netname, asset.metadata?.isp, asset.metadata?.orgName)],
        ['HTTP Status', pick(asset.metadata?.statusCode)],
        ['Content Type', pick(asset.metadata?.contentType)],
        ['Server', pick(asset.metadata?.server)],
      ],
    },
    {
      title: 'Certificate & Crypto',
      items: [
        ['Common Name', pick(asset.commonName, asset.metadata?.commonName)],
        ['SSL SHA Fingerprint', pick(asset.metadata?.fingerprint, asset.metadata?.sha256, asset.metadata?.certFingerprint, asset.metadata?.certificateFingerprint)],
        ['TLS', pick(asset.tlsVersion)],
        ['Key Exchange', pick(asset.keyExchange)],
        ['Signature', pick(asset.signature)],
        ['Software Type', pick(asset.metadata?.softwareType)],
        ['Quantum Safe', quantumSafeStatus],
      ],
    },
  ];

  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter(([, value]) => hasDisplayValue(value)),
    }))
    .filter((section) => section.items.length > 0);

  const cipherSuites = splitCiphers(asset.cipher);
  const badges = [
    ['Type', pick(asset.assetType)],
    ['Host', pick(asset.hostname, asset.domain, asset.url, asset.metadata?.host)],
    ['Quantum Safe', quantumSafeStatus],
  ].filter(([, value]) => hasDisplayValue(value));

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Discovered assets</h3>
          <p>Structured view of scanned endpoints. Showing most information-rich non-certificate/non-ip asset.</p>
        </div>
      </div>

      <section className="asset-record">
        <div className="asset-record-head">
          <div>
            <h4>{pick(asset.name, asset.target)}</h4>
            <p>
              Most informative discovered asset profile
              {asset.createdAt ? ` • Discovered: ${formatWhen(asset.createdAt)}` : ''}
            </p>
          </div>
          <div className="asset-record-badges">
            {badges.map(([label, value]) => (
              <span className="asset-record-badge" key={label}>{label}: {value}</span>
            ))}
          </div>
        </div>

        <div className="asset-record-layout">
          {visibleSections.map((section) => (
            <div className="asset-record-section" key={section.title}>
              <h5>{section.title}</h5>
              <table className="asset-record-table">
                <tbody>
                  {section.items.map(([label, value]) => (
                    <tr key={`${section.title}-${label}`}>
                      <th>{label}</th>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      {cipherSuites.length ? (
        <section className="asset-cipher-section">
          <h5>Cipher Suites</h5>
          <ol className="asset-cipher-list">
            {cipherSuites.map((cipherValue, cipherIndex) => (
              <li key={`${asset._id || asset.target || 'cipher'}-${cipherIndex}`}>{cipherValue}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
