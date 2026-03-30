import {Asset} from '../models/Asset.js';
import {Scan} from '../models/Scan.js';
import { derivePqc, deriveSeverity, assetDisplayName, inferAssetType } from '../utils/securityDerivation.js';
import { generateAiSummary } from '../services/ai/dashboardAiService.js';
import { logger } from '../utils/logger.js';

function migrationPriorityFromGrade(grade = '') {
  if (grade === 'critical') return 'Immediate';
  if (grade === 'legacy') return 'High';
  if (grade === 'standard') return 'Medium';
  return 'Low';
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text;
}

function pickFirst(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function keyLengthCandidates(asset = {}) {
  return [
    asset.keyLength,
    asset.key_length,
    asset.keySize,
    asset.key_size,
    asset.publicKeyLength,
    asset.public_key_length,
    asset.publicKeyBits,
    asset.public_key_bits,
    asset.publicKeySize,
    asset.public_key_size,
    asset.bits,
    asset.metadata?.keyLength,
    asset.metadata?.key_length,
    asset.metadata?.keySize,
    asset.metadata?.key_size,
    asset.metadata?.publicKeyLength,
    asset.metadata?.public_key_length,
    asset.metadata?.publicKeyBits,
    asset.metadata?.public_key_bits,
    asset.metadata?.publicKeySize,
    asset.metadata?.public_key_size,
    asset.metadata?.keyExchangeBits,
    asset.metadata?.key_exchange_bits,
    asset.metadata?.cipherBits,
    asset.metadata?.cipher_bits,
    asset.metadata?.bits,
    asset.metadata?.tls?.keyLength,
    asset.metadata?.tls?.key_length,
    asset.metadata?.tls?.bits,
    asset.metadata?.certificate?.publicKeyBits,
    asset.metadata?.certificate?.publicKeyLength,
    asset.metadata?.security?.keyLength,
    asset.metadata?.security?.publicKeyBits,
  ];
}

function parseHexEntropyBits(value = '') {
  const token = String(value || '').trim();
  if (!token) return 0;
  if (!/^[A-Fa-f0-9]+$/.test(token)) return 0;
  if (token.length < 16) return 0;
  return token.length * 4;
}

function parseBase64EntropyBits(value = '') {
  const token = String(value || '').trim();
  if (!token) return 0;

  const compact = token.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_=-]+$/.test(compact)) return 0;
  if (compact.length < 16) return 0;

  const noPadLength = compact.replace(/=+$/, '').length;
  if (noPadLength < 16) return 0;
  return Math.floor(noPadLength * 6);
}

function estimateBitsFromCipherMaterial(asset = {}) {
  const signals = [
    asset.cipher,
    asset.cipherSuite,
    asset.keyExchange,
    asset.signature,
    asset.metadata?.cipher,
    asset.metadata?.cipherSuite,
    asset.metadata?.keyExchange,
    asset.metadata?.signature,
  ]
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (!signals) return 0;

  const candidates = [];

  const rsaMatches = signals.match(/rsa[-_]?([0-9]{3,5})/g) || [];
  for (const match of rsaMatches) {
    const num = Number(String(match).replace(/[^0-9]/g, ''));
    if (num >= 128 && num <= 16384) candidates.push(num);
  }

  const ecdhMatches = signals.match(/(?:ecdh|ecdsa|secp)[-_]?([0-9]{3,4})/g) || [];
  for (const match of ecdhMatches) {
    const num = Number(String(match).replace(/[^0-9]/g, ''));
    if (num >= 128 && num <= 16384) candidates.push(num);
  }

  const aesMatches = signals.match(/aes[-_]?([0-9]{3})/g) || [];
  for (const match of aesMatches) {
    const num = Number(String(match).replace(/[^0-9]/g, ''));
    if (num >= 128 && num <= 512) candidates.push(num);
  }

  if (signals.includes('chacha20')) candidates.push(256);

  if (!candidates.length) return 0;
  return Math.max(...candidates);
}

function estimateBitsFromApiToken(asset = {}) {
  const candidates = [
    asset.apiKey,
    asset.api_key,
    asset.token,
    asset.secret,
    asset.accessToken,
    asset.clientSecret,
    asset.metadata?.apiKey,
    asset.metadata?.api_key,
    asset.metadata?.token,
    asset.metadata?.secret,
    asset.metadata?.accessToken,
    asset.metadata?.clientSecret,
    asset.metadata?.credentials?.apiKey,
    asset.metadata?.credentials?.token,
    asset.metadata?.auth?.token,
    asset.metadata?.headers?.['x-api-key'],
    asset.metadata?.headers?.authorization,
  ];

  let best = 0;
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;

    const cleaned = raw.replace(/^bearer\s+/i, '').replace(/^[A-Za-z_]+[-_][A-Za-z0-9_]+_/, '');
    const hexBits = parseHexEntropyBits(cleaned);
    const b64Bits = parseBase64EntropyBits(cleaned);
    const bits = Math.max(hexBits, b64Bits);
    if (bits > best) best = bits;
  }

  return best;
}

function resolveKeyLengthRaw(asset = {}) {
  const direct = pickFirst(...keyLengthCandidates(asset));
  if (direct) {
    return { value: String(direct), source: 'direct' };
  }

  const cipherEstimate = estimateBitsFromCipherMaterial(asset);
  if (cipherEstimate > 0) {
    return { value: String(cipherEstimate), source: 'cipher_estimate' };
  }

  const tokenEstimate = estimateBitsFromApiToken(asset);
  if (tokenEstimate > 0) {
    return { value: String(tokenEstimate), source: 'token_entropy_estimate' };
  }

  return { value: '', source: 'missing' };
}

function resolveTlsVersion(asset = {}, assetType = '') {
  const tls = pickFirst(
    asset.tlsVersion,
    asset.protocol,
    asset.metadata?.tlsVersion,
    asset.metadata?.tls_version,
    asset.metadata?.protocol,
    asset.metadata?.tls?.version
  );

  if (tls) return { value: tls, assumed: false };
  if (['domain', 'api'].includes(assetType)) {
    return { value: 'TLSv1.0', assumed: true };
  }

  return { value: '', assumed: false };
}

function assetHostKeys(asset = {}) {
  const keys = [asset.hostname, asset.domain, asset.target, asset.name, asset.url]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .map((value) => value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, ''));

  return Array.from(new Set(keys));
}

function buildCertificateLookup(assets = []) {
  const lookup = new Map();
  const certs = assets.filter((asset) => inferAssetType(asset) === 'certificate');

  const scoreAsset = (asset = {}) => {
    let score = 0;
    if (normalizeText(asset.keyLength || asset.metadata?.keyLength || asset.metadata?.publicKeyBits)) score += 3;
    if (normalizeText(asset.tlsVersion || asset.metadata?.tlsVersion)) score += 2;
    if (normalizeText(asset.cipherSuite || asset.metadata?.cipherSuite)) score += 2;
    if (normalizeText(asset.signature || asset.metadata?.signatureAlgorithm)) score += 1;
    if (normalizeText(asset.keyExchange || asset.metadata?.keyExchange)) score += 1;
    return score;
  };

  for (const cert of certs) {
    const score = scoreAsset(cert);
    for (const key of assetHostKeys(cert)) {
      const existing = lookup.get(key);
      if (!existing || score > existing.score) {
        lookup.set(key, { cert, score });
      }
    }
  }

  return lookup;
}

function mergeCryptoFromCertificate(asset = {}, certLookup = new Map()) {
  const type = inferAssetType(asset);
  if (!['domain', 'api'].includes(type)) return asset;

  const key = assetHostKeys(asset).find((candidate) => certLookup.has(candidate));
  if (!key) return asset;

  const cert = certLookup.get(key)?.cert;
  if (!cert) return asset;

  return {
    ...asset,
    tlsVersion: pickFirst(asset.tlsVersion, asset.protocol, asset.metadata?.tlsVersion, cert.tlsVersion, cert.metadata?.tlsVersion),
    cipherSuite: pickFirst(asset.cipherSuite, asset.cipher, asset.metadata?.cipherSuite, cert.cipherSuite, cert.metadata?.cipherSuite),
    keyLength: pickFirst(
      asset.keyLength,
      asset.metadata?.keyLength,
      asset.metadata?.key_length,
      cert.keyLength,
      cert.metadata?.keyLength,
      cert.metadata?.key_length,
      cert.metadata?.publicKeyBits
    ),
    keyExchange: pickFirst(asset.keyExchange, asset.metadata?.keyExchange, cert.keyExchange, cert.metadata?.keyExchange),
    signature: pickFirst(asset.signature, asset.metadata?.signatureAlgorithm, cert.signature, cert.metadata?.signatureAlgorithm),
    metadata: {
      ...(asset.metadata || {}),
      tlsVersion: pickFirst(asset.metadata?.tlsVersion, cert.metadata?.tlsVersion, cert.tlsVersion),
      cipherSuite: pickFirst(asset.metadata?.cipherSuite, cert.metadata?.cipherSuite, cert.cipherSuite),
      keyLength: pickFirst(asset.metadata?.keyLength, asset.metadata?.key_length, cert.metadata?.keyLength, cert.keyLength),
      publicKeyBits: pickFirst(asset.metadata?.publicKeyBits, cert.metadata?.publicKeyBits),
      publicKeyAlgorithm: pickFirst(asset.metadata?.publicKeyAlgorithm, cert.metadata?.publicKeyAlgorithm),
      signatureAlgorithm: pickFirst(asset.metadata?.signatureAlgorithm, cert.metadata?.signatureAlgorithm, cert.signature),
      keyExchange: pickFirst(asset.metadata?.keyExchange, cert.metadata?.keyExchange, cert.keyExchange),
    },
  };
}

function buildEnrichedPqcAsset(asset = {}) {
  const resolvedAssetType = inferAssetType(asset);
  const resolvedTlsVersion = resolveTlsVersion(asset, resolvedAssetType);
  const resolvedKeyLength = resolveKeyLengthRaw(asset);

  const derivedInput = {
    ...asset,
    assetType: resolvedAssetType,
    tlsVersion: resolvedTlsVersion.value,
    tlsVersionAssumed: resolvedTlsVersion.assumed,
    keyLength: resolvedKeyLength.value,
  };

  const pqc = derivePqc(derivedInput);
  const severity = deriveSeverity(derivedInput);
  const name = assetDisplayName(asset);

  return {
    ...asset,
    name,
    assetType: resolvedAssetType,
    appName: pickFirst(asset.appName, asset.metadata?.appName, asset.metadata?.serviceName),
    owner: pickFirst(asset.owner, asset.metadata?.owner, asset.companyName, asset.registrar),
    target: pickFirst(asset.target, asset.metadata?.target, asset.hostname, asset.domain, asset.url, asset.ipAddress),
    exposure: pickFirst(asset.url, asset.domain, asset.hostname, asset.ipAddress, asset.target),
    tlsVersion: resolvedTlsVersion.value,
    tlsVersionAssumed: resolvedTlsVersion.assumed,
    cipher: pickFirst(asset.cipher, asset.cipherSuite, asset.metadata?.cipher),
    keyLength: resolvedKeyLength.value,
    keyLengthSource: resolvedKeyLength.source,
    issuer: pickFirst(asset.issuer, asset.metadata?.issuer),
    certificateAuthority: pickFirst(asset.certificateAuthority, asset.metadata?.certificateAuthority),
    supportStatus: pqc.supportStatus,
    grade: pqc.grade,
    migrationPriority: migrationPriorityFromGrade(pqc.grade),
    severity,
    findingCount: Array.isArray(asset.findings) ? asset.findings.length : 0,
  };
}

function parseKeyLength(value) {
  const match = String(value || '').match(/\d{3,5}/);
  return match ? Number(match[0]) : 0;
}

function parseAiBullets(text = '') {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const bullets = lines
    .map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter((line) => line.length > 12);

  return Array.from(new Set(bullets)).slice(0, 6);
}

function logKeyLengthCapture(assets = [], meta = {}) {
  const stats = assets.reduce(
    (acc, asset) => {
      const rawKeyLength = String(asset.keyLength || '').trim();
      const metadataKeyLength = String(asset.metadata?.keyLength || asset.metadata?.key_length || '').trim();
      const resolvedObj = resolveKeyLengthRaw(asset);
      const resolved = String(resolvedObj.value || '').trim();
      const parsed = parseKeyLength(resolved);

      if (rawKeyLength) acc.directField += 1;
      if (!rawKeyLength && metadataKeyLength) acc.metadataField += 1;
      if (!resolved) acc.missing += 1;
      if (resolvedObj.source === 'cipher_estimate') acc.cipherEstimated += 1;
      if (resolvedObj.source === 'token_entropy_estimate') acc.tokenEstimated += 1;
      if (parsed > 0) acc.parsedNumeric += 1;
      if (parsed >= 3072) acc.strong3072 += 1;
      if (parsed >= 2048 && parsed < 3072) acc.mid2048 += 1;
      if (parsed > 0 && parsed < 2048) acc.weakUnder2048 += 1;

      return acc;
    },
    {
      totalAssets: assets.length,
      directField: 0,
      metadataField: 0,
      missing: 0,
      cipherEstimated: 0,
      tokenEstimated: 0,
      parsedNumeric: 0,
      strong3072: 0,
      mid2048: 0,
      weakUnder2048: 0,
    }
  );

  const sample = assets.slice(0, 20).map((asset) => {
    const resolved = resolveKeyLengthRaw(asset);

    return {
      name: asset.name || asset.hostname || asset.domain || asset.url || String(asset._id || ''),
      type: asset.assetType,
      rawKeyLength: String(asset.keyLength || '').trim() || null,
      metadataKeyLength: String(asset.metadata?.keyLength || asset.metadata?.key_length || '').trim() || null,
      resolvedKeyLength: String(resolved.value || '').trim() || null,
      keyLengthSource: resolved.source,
      parsedKeyLength: parseKeyLength(resolved.value),
      tlsForGrading: resolveTlsVersion(asset, asset.assetType).value,
      tlsAssumedForGrading: resolveTlsVersion(asset, asset.assetType).assumed,
    };
  });

  logger.info('pqc.keyLength.capture', {
    ...meta,
    ...stats,
    sample,
  });
}

async function getTargetScanId(scanId) {
  return String(scanId || '').trim();
}

function getUserId(req) {
  return req.user?._id || req.user?.id || null;
}

async function getUserScanScope(userId, scanId) {
  const requested = await getTargetScanId(scanId);

  if (requested && requested !== 'latest') {
    const scan = await Scan.findOne({ _id: requested, userId }).select('_id').lean();
    return {
      targetScanId: scan?._id || null,
      scanIds: scan?._id ? [scan._id] : [],
    };
  }

  if (requested === 'latest') {
    const latestScan = await Scan.findOne({ userId }).sort({ createdAt: -1 }).select('_id').lean();
    return {
      targetScanId: latestScan?._id || null,
      scanIds: latestScan?._id ? [latestScan._id] : [],
    };
  }

  const userScans = await Scan.find({ userId }).select('_id').lean();
  const scanIds = userScans.map((item) => item._id);
  return {
    targetScanId: null,
    scanIds,
  };
}

export async function getPqcOverview(req, res, next) {
  try {
    const userId = getUserId(req);
    const scanId = req.query.scanId;
    const { targetScanId, scanIds } = await getUserScanScope(userId, scanId);

    const assets = !scanIds.length
      ? []
      : await Asset.find(targetScanId ? { scanId: targetScanId } : { scanId: { $in: scanIds } }).lean();

    const counts = {
      elite: 0,
      standard: 0,
      legacy: 0,
      critical: 0,
    };

    const certLookup = buildCertificateLookup(assets);
    const enrichedAssets = assets.map((asset) => {
      const withCertFallback = mergeCryptoFromCertificate(asset, certLookup);
      const enriched = buildEnrichedPqcAsset(withCertFallback);

      counts[enriched.grade] += 1;

      return enriched;
    });

    logKeyLengthCapture(enrichedAssets, {
      endpoint: 'getPqcOverview',
      scanId: String(scanId || 'latest'),
      targetScanId: String(targetScanId || ''),
    });

    const total = Math.max(1, enrichedAssets.length);
    const applicationStatus = [
      { label: 'Elite-PQC Ready', percent: Math.round((counts.elite / total) * 100) },
      { label: 'Standard', percent: Math.round((counts.standard / total) * 100) },
      { label: 'Legacy', percent: Math.round((counts.legacy / total) * 100) },
      { label: 'Critical', percent: Math.round((counts.critical / total) * 100) },
    ];

    const riskOverview = enrichedAssets
      .sort((a, b) => {
        const order = { critical: 4, high: 3, moderate: 2, low: 1 };
        return (order[b.severity] || 0) - (order[a.severity] || 0);
      })
      .slice(0, 8)
      .map((asset) => ({
        label: assetDisplayName(asset).slice(0, 16),
        level: asset.severity,
      }));

    const fallbackRecommendations = [];
    if (counts.critical > 0) fallbackRecommendations.push('Upgrade or isolate critical assets using obsolete protocols or weak key sizes.');
    if (counts.legacy > 0) fallbackRecommendations.push('Prioritize legacy assets for TLS modernization and PQC migration planning.');
    if (counts.standard > 0) fallbackRecommendations.push('Move standard assets toward stronger key sizes and modern cipher suites.');
    if (counts.elite > 0) fallbackRecommendations.push('Preserve elite assets as the baseline template for future rollouts.');

    const domainApiAssets = enrichedAssets.filter((asset) => ['domain', 'api'].includes(asset.assetType));
    const exposureCounts = domainApiAssets.reduce((acc, asset) => {
      const key = (asset.exposure || asset.name || 'unknown').toLowerCase();
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map());

    const tlsCounts = enrichedAssets.reduce((acc, asset) => {
      const key = (asset.tlsVersion || 'unknown').toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const weakProtocolCount = enrichedAssets.filter((asset) => {
      const tls = String(asset.tlsVersion || '').toLowerCase();
      return tls.includes('ssl') || tls.includes('1.0') || tls.includes('1.1');
    }).length;

    const weakCipherCount = enrichedAssets.filter((asset) => {
      const cipher = String(asset.cipher || '').toLowerCase();
      return ['3des', 'rc4', 'des', 'md5', 'sha1', 'cbc'].some((bad) => cipher.includes(bad));
    }).length;

    const keyLengthStats = enrichedAssets.reduce(
      (acc, asset) => {
        const key = parseKeyLength(asset.keyLength);
        if (key > 0 && key < 1024) acc.below1024 += 1;
        else if (key >= 1024 && key < 2048) acc.between1024And2047 += 1;
        else if (key >= 2048 && key < 3072) acc.between2048And3071 += 1;
        else if (key >= 3072) acc.above3072 += 1;
        else acc.unknown += 1;
        return acc;
      },
      { below1024: 0, between1024And2047: 0, between2048And3071: 0, above3072: 0, unknown: 0 }
    );

    const riskyAssets = enrichedAssets
      .filter((asset) => ['critical', 'high'].includes(String(asset.severity || '').toLowerCase()))
      .slice(0, 10)
      .map((asset) => `${asset.name} (${asset.assetType}) tls=${asset.tlsVersion || '-'} cipher=${asset.cipher || '-'} key=${asset.keyLength || '-'}`);

    const allFacts = [
      `Total assets in scan scope: ${enrichedAssets.length}`,
      `Domain/API assets displayed in table: ${domainApiAssets.length}`,
      `Unique exposure groups (domain/api): ${exposureCounts.size}`,
      `Grade counts -> Elite ${counts.elite}, Standard ${counts.standard}, Legacy ${counts.legacy}, Critical ${counts.critical}`,
      `Application status distribution: ${applicationStatus.map((item) => `${item.label} ${item.percent}%`).join(', ')}`,
      `Risk heatmap labels: ${riskOverview.map((item) => `${item.label}:${item.level}`).join(', ') || 'none'}`,
      `TLS distribution: ${Object.entries(tlsCounts).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'}`,
      `Weak protocol assets (SSL/TLS1.0/1.1): ${weakProtocolCount}`,
      `Weak cipher assets (3DES/RC4/DES/MD5/SHA1/CBC): ${weakCipherCount}`,
      `Key length distribution -> <1024:${keyLengthStats.below1024}, 1024-2047:${keyLengthStats.between1024And2047}, 2048-3071:${keyLengthStats.between2048And3071}, >=3072:${keyLengthStats.above3072}, unknown:${keyLengthStats.unknown}`,
      `Top risky assets: ${riskyAssets.join(' | ') || 'none'}`,
    ];

    const aiRecommendationText = await generateAiSummary({
      title: 'PQC Improvement Recommendations',
      style: 'pqc-dashboard',
      facts: allFacts,
      extraInstructions:
        'Focus recommendations on exposure-based rollout. Prioritize domain/api hardening plans, cipher suite modernization, certificate renewal hygiene, and key-length upgrades tied to concrete owner teams.',
      fallback: fallbackRecommendations.join('\n'),
    });

    const recommendations = parseAiBullets(aiRecommendationText);

    const aiSummary = await generateAiSummary({
      title: 'PQC Posture Executive Summary',
      facts: allFacts,
      extraInstructions:
        'Write a concise 4-sentence executive summary that references grade mix, risk density, protocol/cipher weakness, and the immediate next migration theme.',
      fallback:
        `The current PQC posture shows ${counts.legacy + counts.critical} assets needing urgent migration focus. ` +
        `Standard and elite assets should be used as reference baselines while legacy services are upgraded.`,
    });

    res.json({
      counts,
      applicationStatus,
      riskOverview,
      assets: enrichedAssets.slice(0, 25),
      recommendations: recommendations.length ? recommendations : fallbackRecommendations,
      aiSummary,
    });
  } catch (error) {
    next(error);
  }
}

export async function listPqcAssets(req, res, next) {
  try {
    const userId = getUserId(req);
    const { grade, scanId } = req.query;
    const { targetScanId, scanIds } = await getUserScanScope(userId, scanId);
    const assets = !scanIds.length
      ? []
      : await Asset.find(targetScanId ? { scanId: targetScanId } : { scanId: { $in: scanIds } })
          .sort({ createdAt: -1 })
          .lean();

    const certLookup = buildCertificateLookup(assets);

    const enriched = assets
      .map((asset) => mergeCryptoFromCertificate(asset, certLookup))
      .map((asset) => buildEnrichedPqcAsset(asset))
      .filter((asset) => ['domain', 'api'].includes(asset.assetType));

    logKeyLengthCapture(enriched, {
      endpoint: 'listPqcAssets',
      scanId: String(scanId || 'all'),
      gradeFilter: String(grade || 'all'),
    });

    const filtered = grade
      ? enriched.filter((asset) => asset.grade === grade)
      : enriched;

    res.json({ assets: filtered });
  } catch (error) {
    next(error);
  }
}