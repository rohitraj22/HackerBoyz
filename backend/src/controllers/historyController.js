import { Scan } from '../models/Scan.js';
import { Asset } from '../models/Asset.js';
import { successResponse } from '../utils/responseFormatter.js';
import { isWeakCipher, isWeakProtocol } from '../utils/securityDerivation.js';
import { generateAiSummary } from '../services/ai/dashboardAiService.js';

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function hydrateScanInventory(scan, assets) {
  const pick = (...candidates) => {
    for (const predicate of candidates) {
      const found = assets.find(predicate);
      if (found) return found;
    }
    return null;
  };

  const domainAsset = pick(
    (asset) => asset.assetType === 'domain',
    (asset) => Boolean(asset.domain || asset.registrar)
  );

  const certAsset = pick(
    (asset) => asset.assetType === 'certificate',
    (asset) => Boolean(asset.commonName || asset.certificateAuthority || asset.metadata?.fingerprint)
  );

  const ipAsset = pick(
    (asset) => asset.assetType === 'ip' || asset.assetType === 'server',
    (asset) => Boolean(asset.ipAddress || asset.subnet || asset.metadata?.asn)
  );

  const apiAsset = pick(
    (asset) => asset.assetType === 'api',
    (asset) => Boolean(asset.url || asset.hostname || asset.apiPath || asset.port)
  );

  const softwareAsset = pick(
    (asset) => asset.assetType === 'software' || asset.assetType === 'webapp',
    (asset) => Boolean(asset.softwareName || asset.product || asset.softwareVersion)
  );

  return {
    registrationDate: firstNonEmpty(
      domainAsset?.registrationDate,
      domainAsset?.metadata?.registrationDate
    ),
    sslShaFingerprint: firstNonEmpty(
      certAsset?.metadata?.fingerprint,
      certAsset?.metadata?.sha256,
      certAsset?.metadata?.certFingerprint,
      certAsset?.metadata?.certificateFingerprint
    ),
    registrarCompanyName: firstNonEmpty(
      domainAsset?.registrar,
      domainAsset?.metadata?.registrar
    ),
    commonName: firstNonEmpty(
      certAsset?.commonName,
      apiAsset?.commonName,
      certAsset?.name,
      certAsset?.domain,
      certAsset?.hostname
    ),
    cipher: firstNonEmpty(
      certAsset?.cipher,
      certAsset?.cipherSuite,
      apiAsset?.cipher,
      apiAsset?.cipherSuite,
      certAsset?.metadata?.cipher,
      certAsset?.metadata?.cipherSuite,
      apiAsset?.metadata?.cipher,
      apiAsset?.metadata?.cipherSuite
    ),
    keyLength: firstNonEmpty(
      certAsset?.keyLength,
      apiAsset?.keyLength,
      certAsset?.metadata?.keyLength,
      certAsset?.metadata?.key_length,
      apiAsset?.metadata?.keyLength,
      apiAsset?.metadata?.key_length
    ),
    tlsVersion: firstNonEmpty(
      certAsset?.tlsVersion,
      apiAsset?.tlsVersion,
      certAsset?.metadata?.tlsVersion,
      apiAsset?.metadata?.tlsVersion,
      certAsset?.metadata?.sslVersion,
      apiAsset?.metadata?.sslVersion
    ),
    companyName: firstNonEmpty(
      domainAsset?.owner,
      certAsset?.owner,
      softwareAsset?.owner,
      ipAsset?.owner,
      domainAsset?.metadata?.companyName,
      certAsset?.metadata?.organization,
      ipAsset?.metadata?.organization,
      apiAsset?.owner,
      apiAsset?.metadata?.companyName
    ),
    host: firstNonEmpty(
      softwareAsset?.hostname,
      apiAsset?.hostname,
      apiAsset?.url,
      domainAsset?.hostname,
      ipAsset?.hostname,
      domainAsset?.domain,
      scan.domain,
      scan.apiEndpoint
    ),
    port: firstNonEmpty(
      softwareAsset?.port,
      apiAsset?.port,
      ipAsset?.port,
      certAsset?.port,
      ipAsset?.metadata?.ports
    ),
    version: firstNonEmpty(
      softwareAsset?.softwareVersion,
      apiAsset?.softwareVersion,
      softwareAsset?.metadata?.version,
      certAsset?.tlsVersion,
      apiAsset?.tlsVersion,
      certAsset?.metadata?.tlsVersion
    ),
    type: firstNonEmpty(
      softwareAsset?.metadata?.softwareType,
      apiAsset?.metadata?.softwareType,
      softwareAsset?.assetType,
      apiAsset?.assetType,
      ipAsset?.assetType,
      certAsset?.assetType,
      domainAsset?.assetType
    ),
    location: firstNonEmpty(
      apiAsset?.metadata?.location,
      ipAsset?.metadata?.location,
      apiAsset?.metadata?.country,
      ipAsset?.metadata?.city,
      apiAsset?.metadata?.city,
      ipAsset?.metadata?.country
    ),
    netname: firstNonEmpty(
      apiAsset?.metadata?.netname,
      ipAsset?.metadata?.netname,
      apiAsset?.metadata?.isp,
      ipAsset?.metadata?.isp,
      apiAsset?.metadata?.orgName,
      ipAsset?.metadata?.orgName
    ),
  };
}

function scanTarget(scan = {}) {
  const target = String(scan.domain || scan.apiEndpoint || scan.inventory?.host || '').trim();
  return target || '';
}

async function buildTargetSummaries(scans = []) {
  const groups = new Map();

  for (const scan of scans) {
    const target = scanTarget(scan);
    if (!target) continue;

    const key = target.toLowerCase();
    const group = groups.get(key) || { key, target, scans: [] };
    group.scans.push(scan);
    groups.set(key, group);
  }

  const summaries = [...groups.values()].map((group) => {
    const scores = group.scans
      .map((item) => Number(item.overallRiskScore))
      .filter((score) => Number.isFinite(score));

    const averageScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : 0;

    const weakProtocolCount = group.scans.filter((item) => isWeakProtocol(item.inventory?.tlsVersion || item.inventory?.version)).length;
    const weakCipherCount = group.scans.filter((item) => isWeakCipher(item.inventory?.cipher)).length;
    const latestAt = group.scans[0]?.createdAt || null;

    const topCipherMap = new Map();
    const topProtocolMap = new Map();

    for (const scan of group.scans) {
      const cipher = String(scan.inventory?.cipher || '').trim();
      const protocol = String(scan.inventory?.tlsVersion || scan.inventory?.version || '').trim();

      if (cipher) topCipherMap.set(cipher, (topCipherMap.get(cipher) || 0) + 1);
      if (protocol) topProtocolMap.set(protocol, (topProtocolMap.get(protocol) || 0) + 1);
    }

    const topCipher = [...topCipherMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
    const topProtocol = [...topProtocolMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    return {
      key: group.key,
      target: group.target,
      scanIds: group.scans.map((scan) => String(scan._id || '')).filter(Boolean),
      scanCount: group.scans.length,
      averageScore,
      latestAt,
      weakProtocolCount,
      weakCipherCount,
      topCipher,
      topProtocol,
    };
  });

  const withRecommendations = await Promise.all(
    summaries.map(async (summary) => {
      const recommendation = await generateAiSummary({
        title: `PQC recommendations for ${summary.target}`,
        style: 'pqc-target',
        extraInstructions:
          'Prioritize cryptographic modernization. Mention concrete controls (protocol floor, cipher allowlist, cert automation, and monitoring).',
        facts: [
          `Target: ${summary.target}`,
          `Total scans: ${summary.scanCount}`,
          `Average risk score: ${summary.averageScore}`,
          `Weak protocol observations: ${summary.weakProtocolCount}`,
          `Weak cipher observations: ${summary.weakCipherCount}`,
          `Most common protocol: ${summary.topProtocol}`,
          `Most common cipher: ${summary.topCipher}`,
        ],
        fallback: [
          `- Immediate: For ${summary.target}, block TLS 1.0/1.1 and legacy SSL where detected (${summary.weakProtocolCount} weak-protocol observations).`,
          `- 30 days: Enforce a modern cipher allowlist and remove weak suites (${summary.weakCipherCount} weak-cipher observations, top cipher: ${summary.topCipher}).`,
          `- 60-90 days: Standardize certificate lifecycle controls (issuer policy, renewal automation, and expiry alerts) with protocol baseline ${summary.topProtocol}.`,
          `- Ongoing: Track average risk score (${summary.averageScore}) monthly and gate releases when cryptographic baseline checks fail.`,
        ].join('\n'),
      });

      return {
        ...summary,
        pqcRecommendation: recommendation,
      };
    })
  );

  return withRecommendations.sort((a, b) => b.averageScore - a.averageScore || a.target.localeCompare(b.target));
}

export async function getHistory(req, res, next) {
  try {
    const includeTargetSummaries = String(req.query.includeTargetSummaries || '').toLowerCase() === 'true';
    const userId = req.user?._id || req.user?.id || null;
    const scans = await Scan.find({ userId })
      .select('domain apiEndpoint overallRiskScore riskLevel createdAt')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const scanIds = scans.map((scan) => scan._id).filter(Boolean);

    const assets = scanIds.length
      ? await Asset.find({ scanId: { $in: scanIds } })
          .select([
            'scanId',
            'assetType',
            'hostname',
            'domain',
            'name',
            'url',
            'apiPath',
            'owner',
            'ipAddress',
            'subnet',
            'port',
            'softwareVersion',
            'softwareName',
            'product',
            'registrationDate',
            'registrar',
            'commonName',
            'certificateAuthority',
            'tlsVersion',
            'cipher',
            'cipherSuite',
            'keyLength',
            'metadata',
          ].join(' '))
          .lean()
      : [];

    const assetsByScanId = new Map();
    for (const asset of assets) {
      const key = String(asset.scanId || '');
      if (!key) continue;
      if (!assetsByScanId.has(key)) assetsByScanId.set(key, []);
      assetsByScanId.get(key).push(asset);
    }

    const enrichedScans = scans.map((scan) => {
      const scanAssets = assetsByScanId.get(String(scan._id)) || [];
      return {
        ...scan,
        inventory: hydrateScanInventory(scan, scanAssets),
      };
    });

    const stats = {
      totalScans: enrichedScans.length,
      critical: enrichedScans.filter((scan) => scan.riskLevel === 'Critical').length,
      high: enrichedScans.filter((scan) => scan.riskLevel === 'High').length,
      moderate: enrichedScans.filter((scan) => scan.riskLevel === 'Moderate').length,
      low: enrichedScans.filter((scan) => scan.riskLevel === 'Low').length
    };

    const targetSummaries = includeTargetSummaries
      ? await buildTargetSummaries(enrichedScans)
      : [];

    return res.json(successResponse({ stats, scans: enrichedScans, targetSummaries }));
  } catch (error) {
    next(error);
  }
}
