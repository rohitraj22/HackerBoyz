import {Asset} from '../models/Asset.js';
import {Scan} from '../models/Scan.js';
import { computeAssetScore, assetDisplayName, isWeakCipher, isWeakProtocol, parseKeyLength, derivePqc, deriveSeverity } from '../utils/securityDerivation.js';
import { generateAiSummary } from '../services/ai/dashboardAiService.js';

const RAW_ENTERPRISE_MAX_SCORE = 950;
const ENTERPRISE_MAX_SCORE = 1000;
const EXTERNAL_WEIGHT = 0.5;
const INTERNAL_WEIGHT = 0.5;
const MAX_THREAT_DEDUCTION = 15;

function getUserId(req) {
  return req.user?._id || req.user?.id || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

function linearScaleTo1000(rawScore) {
  // Linear transform (regression with fixed anchors): (0,0) and (950,1000)
  const slope = ENTERPRISE_MAX_SCORE / RAW_ENTERPRISE_MAX_SCORE;
  const intercept = 0;
  return clamp(Math.round(rawScore * slope + intercept), 0, ENTERPRISE_MAX_SCORE);
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(value) {
  const date = toDate(value);
  if (!date) return null;
  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function extractQuestionnairePayload(scan = {}) {
  return (
    scan?.metadata?.questionnaire ||
    scan?.metadata?.internalAssessment ||
    scan?.report?.questionnaire ||
    scan?.report?.internalControls ||
    scan?.metadata?.controls ||
    null
  );
}

function collectNumericScores(input, bag = []) {
  if (input === null || input === undefined) return bag;
  if (typeof input === 'number' && Number.isFinite(input)) {
    bag.push(input);
    return bag;
  }

  if (Array.isArray(input)) {
    input.forEach((item) => collectNumericScores(item, bag));
    return bag;
  }

  if (typeof input === 'object') {
    Object.values(input).forEach((value) => collectNumericScores(value, bag));
  }

  return bag;
}

function detectCompromiseSignals(text = '') {
  const normalized = normalize(text);
  if (!normalized) return 0;

  const markers = [
    'botnet',
    'malware',
    'compromised',
    'breach',
    'ransom',
    'credential leak',
    'dark web',
    'exfil',
    'c2',
    'command and control',
  ];

  return markers.some((item) => normalized.includes(item)) ? 1 : 0;
}

function businessCriticalityWeight(asset = {}) {
  const source = normalize(
    asset.criticality ||
      asset.businessCriticality ||
      asset.metadata?.criticality ||
      asset.metadata?.businessCriticality ||
      asset.metadata?.tier
  );

  if (['critical', 'tier0', 'tier1', 'high'].includes(source)) return 1.5;
  if (['medium', 'tier2'].includes(source)) return 1.2;
  return 1;
}

function scoreToEnterpriseLabel(score) {
  if (score >= 800) return 'Elite-PQC';
  if (score >= 400) return 'Standard';
  if (score >= 211) return 'Legacy';
  return 'Critical';
}

function scoreFromSeverity(asset = {}) {
  const severity = normalize(asset.severity || asset.riskSeverity || asset.metadata?.severity);
  if (severity === 'critical') return 20;
  if (severity === 'high') return 45;
  if (severity === 'moderate') return 70;
  if (severity === 'low') return 90;
  return null;
}

function scoreFromPqcSignals(asset = {}) {
  const pqc = derivePqc(asset);
  const severity = deriveSeverity(asset);

  const grade = normalize(pqc?.grade);
  const support = normalize(pqc?.supportStatus);

  let scoreByGrade = 70;
  if (grade === 'elite') scoreByGrade = 92;
  else if (grade === 'standard') scoreByGrade = 72;
  else if (grade === 'legacy') scoreByGrade = 46;
  else if (grade === 'critical') scoreByGrade = 24;

  let supportAdjust = 0;
  if (support === 'ready') supportAdjust = 5;
  else if (support === 'legacy') supportAdjust = -8;
  else if (support === 'critical') supportAdjust = -15;

  let severityPenalty = 0;
  if (severity === 'critical') severityPenalty = 20;
  else if (severity === 'high') severityPenalty = 12;
  else if (severity === 'moderate') severityPenalty = 6;

  return clamp(Math.round(scoreByGrade + supportAdjust - severityPenalty), 0, 100);
}

function resolveAssetScore(asset = {}) {
  const explicitRiskScore = Number(
    asset.riskScore ??
      asset.overallRiskScore ??
      asset.pqcScore ??
      asset.metadata?.riskScore ??
      asset.metadata?.overallRiskScore ??
      asset.metadata?.pqcScore
  );

  if (Number.isFinite(explicitRiskScore)) {
    const normalizedExplicit = explicitRiskScore > 100 ? explicitRiskScore / 10 : explicitRiskScore;
    return clamp(Math.round(normalizedExplicit), 0, 100);
  }

  const computed = computeAssetScore(asset);
  const pqcDerived = scoreFromPqcSignals(asset);

  if (computed < 100) {
    return clamp(Math.round(computed * 0.65 + pqcDerived * 0.35), 0, 100);
  }

  const fallbackSeverityScore = scoreFromSeverity(asset);
  if (fallbackSeverityScore !== null) {
    return clamp(Math.round(fallbackSeverityScore * 0.5 + pqcDerived * 0.5), 0, 100);
  }

  return pqcDerived;
}

function computeExternalAttackSurfaceScore(assets = []) {
  if (!assets.length) {
    return {
      score: 0,
      weakTls: 0,
      weakCipher: 0,
      lowKey: 0,
      expired: 0,
      mttpDays: 0,
    };
  }

  let riskPoints = 0;
  let weakTls = 0;
  let weakCipher = 0;
  let lowKey = 0;
  let expired = 0;
  let unresolvedAgeDaysTotal = 0;
  let unresolvedRiskCount = 0;

  for (const asset of assets) {
    const weight = businessCriticalityWeight(asset);
    const tls = asset.tlsVersion || asset.protocol;
    const cipher = asset.cipherSuite || asset.cipher;
    const keyLength = parseKeyLength(asset.keyLength || asset.metadata?.keyLength);
    const validTo = toDate(asset.validTo || asset.expiresAt || asset.metadata?.validTo);
    const severity = normalize(asset.severity || asset.riskSeverity || asset.metadata?.severity);
    const status = normalize(asset.status);

    if (isWeakProtocol(tls)) {
      weakTls += 1;
      riskPoints += 20 * weight;
    }
    if (isWeakCipher(cipher)) {
      weakCipher += 1;
      riskPoints += 14 * weight;
    }
    if (keyLength > 0 && keyLength < 1024) {
      lowKey += 1;
      riskPoints += 18 * weight;
    } else if (keyLength > 0 && keyLength < 2048) {
      lowKey += 1;
      riskPoints += 10 * weight;
    }

    if (validTo) {
      const daysLeft = (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysLeft < 0) {
        expired += 1;
        riskPoints += 16 * weight;
      } else if (daysLeft <= 30) {
        riskPoints += 8 * weight;
      }
    }

    if (severity === 'critical') riskPoints += 18 * weight;
    else if (severity === 'high') riskPoints += 12 * weight;
    else if (severity === 'moderate') riskPoints += 6 * weight;
    else if (severity === 'low') riskPoints += 2 * weight;

    if (status !== 'resolved' && (severity === 'critical' || severity === 'high')) {
      const ageDays = daysSince(asset.updatedAt || asset.createdAt);
      if (ageDays !== null) {
        unresolvedAgeDaysTotal += ageDays;
        unresolvedRiskCount += 1;
      }
    }
  }

  const maxRiskPoints = assets.length * 70;
  let score = 100 - (riskPoints / Math.max(1, maxRiskPoints)) * 100;

  const mttpDays = unresolvedRiskCount ? unresolvedAgeDaysTotal / unresolvedRiskCount : 0;
  const mttpPenalty = clamp(mttpDays / 3, 0, 20);
  score -= mttpPenalty;

  return {
    score: clamp(Math.round(score), 0, 100),
    weakTls,
    weakCipher,
    lowKey,
    expired,
    mttpDays: Math.round(mttpDays),
  };
}

function computeInternalControlsScore(scans = [], assets = []) {
  const numericValues = scans.flatMap((scan) => {
    const questionnaire = extractQuestionnairePayload(scan);
    return collectNumericScores(questionnaire, []);
  });

  const normalizedQuestionnaireScores = numericValues
    .map((value) => {
      if (value <= 1) return value * 100;
      if (value <= 5) return (value / 5) * 100;
      if (value <= 10) return (value / 10) * 100;
      if (value <= 100) return value;
      return 100;
    })
    .filter((value) => Number.isFinite(value));

  if (normalizedQuestionnaireScores.length) {
    const average = normalizedQuestionnaireScores.reduce((sum, value) => sum + value, 0) / normalizedQuestionnaireScores.length;
    return {
      score: clamp(Math.round(average), 0, 100),
      source: 'questionnaire',
    };
  }

  if (!assets.length) {
    return {
      score: 50,
      source: 'proxy',
    };
  }

  const resolvedRatio = assets.filter((asset) => normalize(asset.status) === 'resolved').length / assets.length;
  const ownerCoverage = assets.filter((asset) => normalize(asset.owner)).length / assets.length;
  const tlsPolicyCoverage = assets.filter((asset) => normalize(asset.tlsVersion || asset.protocol)).length / assets.length;

  const proxyScore =
    40 +
    resolvedRatio * 25 +
    ownerCoverage * 20 +
    tlsPolicyCoverage * 15;

  return {
    score: clamp(Math.round(proxyScore), 0, 100),
    source: 'proxy',
  };
}

function computeThreatContextScore(scans = [], assets = []) {
  let signalCount = 0;

  for (const scan of scans) {
    (scan.findings || []).forEach((value) => {
      signalCount += detectCompromiseSignals(value);
    });
    (scan.warnings || []).forEach((value) => {
      signalCount += detectCompromiseSignals(value);
    });
  }

  let criticalExposures = 0;
  let unresolvedHigh = 0;

  for (const asset of assets) {
    const textFields = [
      asset.summary,
      ...(Array.isArray(asset.findings) ? asset.findings : []),
      Array.isArray(asset.metadata?.findings) ? asset.metadata.findings.join(' ') : '',
    ];
    textFields.forEach((text) => {
      signalCount += detectCompromiseSignals(text);
    });

    const weight = businessCriticalityWeight(asset);
    const severity = normalize(asset.severity || asset.riskSeverity || asset.metadata?.severity);
    const status = normalize(asset.status);

    if (weight > 1 && (severity === 'critical' || severity === 'high')) {
      criticalExposures += 1;
    }
    if (status !== 'resolved' && (severity === 'critical' || severity === 'high')) {
      unresolvedHigh += 1;
    }
  }

  const riskPoints = signalCount * 12 + criticalExposures * 4 + unresolvedHigh * 3;
  const score = clamp(Math.round(100 - riskPoints), 0, 100);

  return {
    score,
    signalCount,
    criticalExposures,
    unresolvedHigh,
  };
}

function buildFactorRows(metrics) {
  const {
    external,
    internal,
    threat,
    weightedBase,
    threatDeduction,
    scanCount,
    weakTls,
    weakCipher,
    lowKey,
    expired,
    mttpDays,
    internalSource,
  } = metrics;

  return [
    { name: 'External Attack Surface', value: external },
    { name: 'Internal Controls', value: internal },
    { name: 'Threat Intelligence Context', value: threat },
    { name: 'Weighted Base Score', value: weightedBase },
    { name: 'Threat Context Deduction', value: threatDeduction },
    { name: 'Mean Time To Patch (days)', value: mttpDays },
    { name: 'Weak TLS / SSL Findings', value: weakTls },
    { name: 'Weak Cipher Findings', value: weakCipher },
    { name: 'Low Key-Length Findings', value: lowKey },
    { name: 'Expired Certificates', value: expired },
    { name: 'Scans Averaged', value: scanCount },
  ];
}

function buildEnterpriseScorecard(assets = [], scans = []) {
  const assetScores = assets.map((asset) => ({
    asset,
    score: resolveAssetScore(asset),
  }));

  const external = computeExternalAttackSurfaceScore(assets);
  const internal = computeInternalControlsScore(scans, assets);
  const threat = computeThreatContextScore(scans, assets);

  const weightedBase = EXTERNAL_WEIGHT * external.score + INTERNAL_WEIGHT * internal.score;
  const threatDeduction = ((100 - threat.score) / 100) * MAX_THREAT_DEDUCTION;
  const final0to100 = clamp(weightedBase - threatDeduction, 0, 100);

  const rawNormalizedScore = Math.round((final0to100 / 100) * RAW_ENTERPRISE_MAX_SCORE);
  const normalizedScore = linearScaleTo1000(rawNormalizedScore);
  const label = scoreToEnterpriseLabel(normalizedScore);

  const factors = buildFactorRows({
    external: external.score,
    internal: internal.score,
    threat: threat.score,
    weightedBase: Math.round(weightedBase),
    threatDeduction: Math.round(threatDeduction),
    weakTls: external.weakTls,
    weakCipher: external.weakCipher,
    lowKey: external.lowKey,
    expired: external.expired,
    mttpDays: external.mttpDays,
    scanCount: scans.length || (assets.length ? 1 : 0),
    internalSource: internal.source,
  });

  const urlScores = assetScores
    .map(({ asset, score }) => ({
      url: asset.url || asset.hostname || asset.domain || assetDisplayName(asset),
      score,
      grade: score >= 85 ? 'Elite' : score >= 65 ? 'Standard' : score >= 45 ? 'Legacy' : 'Critical',
    }))
    .slice(0, 25);

  return {
    normalizedScore,
    label,
    factors,
    urlScores,
  };
}

function buildPortfolioScorecard(allAssets = [], scans = []) {
  if (!allAssets.length || !scans.length) {
    return {
      normalizedScore: 0,
      label: scoreToEnterpriseLabel(0),
      factors: buildFactorRows({
        external: 0,
        internal: 50,
        threat: 50,
        weightedBase: 0,
        threatDeduction: 0,
        weakTls: 0,
        weakCipher: 0,
        lowKey: 0,
        expired: 0,
        mttpDays: 0,
        scanCount: 0,
        internalSource: 'proxy',
      }),
      urlScores: [],
      scanCount: 0,
    };
  }

  const byScan = new Map();
  for (const asset of allAssets) {
    const key = String(asset.scanId || 'unknown');
    if (!byScan.has(key)) byScan.set(key, []);
    byScan.get(key).push(asset);
  }

  const scanById = new Map(scans.map((scan) => [String(scan._id), scan]));
  const scanScorecards = [...byScan.entries()].map(([scanId, assets]) => {
    const scan = scanById.get(scanId);
    return buildEnterpriseScorecard(assets, scan ? [scan] : []);
  });

  const averageNormalizedScore = Math.round(
    scanScorecards.reduce((sum, item) => sum + Number(item.normalizedScore || 0), 0) / Math.max(1, scanScorecards.length)
  );

  const aggregateScorecard = buildEnterpriseScorecard(allAssets, scans);

  const urlScores = [...allAssets]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 25)
    .map((asset) => {
      const score = resolveAssetScore(asset);
      return {
        url: asset.url || asset.hostname || asset.domain || assetDisplayName(asset),
        score,
        grade: score >= 85 ? 'Elite' : score >= 65 ? 'Standard' : score >= 45 ? 'Legacy' : 'Critical',
      };
    });

  return {
    normalizedScore: averageNormalizedScore,
    label: scoreToEnterpriseLabel(averageNormalizedScore),
    factors: aggregateScorecard.factors,
    urlScores,
    scanCount: scanScorecards.length,
  };
}

export async function getEnterpriseRating(req, res, next) {
  try {
    const userId = getUserId(req);
    const scans = await Scan.find({ userId }).select('_id metadata report findings warnings createdAt updatedAt').lean();
    const scanIds = scans.map((scan) => scan._id);
    const assets = scanIds.length ? await Asset.find({ scanId: { $in: scanIds } }).lean() : [];
    const scorecard = buildPortfolioScorecard(assets, scans);

    const aiSummary = await generateAiSummary({
      title: 'Enterprise Cyber Rating',
      facts: [
        `Normalized enterprise score: ${scorecard.normalizedScore}/${ENTERPRISE_MAX_SCORE}`,
        `Enterprise label: ${scorecard.label}`,
        `Scans considered: ${scorecard.scanCount || 0}`,
        ...scorecard.factors.map((f) => `${f.name}: ${f.value}`),
      ],
      fallback:
        `The enterprise currently scores ${scorecard.normalizedScore}/${ENTERPRISE_MAX_SCORE} and falls into the ${scorecard.label} band. ` +
        `The score uses a weighted external/internal model with threat-context deductions and scan-averaged consolidation.`,
    });

    res.json({
      ...scorecard,
      scanId: '',
      scoreMax: ENTERPRISE_MAX_SCORE,
      aiSummary,
      tiers: [
        { tier: 'Critical', range: '< 211', note: 'Immediate containment and emergency remediation needed' },
        { tier: 'Legacy', range: '211 - 399', note: 'Weak posture, prioritize remediation roadmap' },
        { tier: 'Standard', range: '400 - 799', note: 'Acceptable but improvable posture' },
        { tier: 'Elite-PQC', range: '800 - 1000', note: 'Strong, modern cryptographic posture' },
      ],
    });
  } catch (error) {
    next(error);
  }
}

export async function recalculateEnterpriseRating(req, res, next) {
  try {
    const userId = getUserId(req);
    const requestedScanId = String(req.params.scanId || '').trim();
    const scanFilter = requestedScanId ? { _id: requestedScanId, userId } : { userId };
    const scans = await Scan.find(scanFilter).select('_id metadata report findings warnings createdAt updatedAt').lean();

    if (requestedScanId && !scans.length) {
      return res.status(404).json({ message: 'Scan not found' });
    }

    const scanIds = scans.map((scan) => scan._id);
    const allAssets = scanIds.length ? await Asset.find({ scanId: { $in: scanIds } }).lean() : [];
    const assetsByScan = new Map();
    for (const asset of allAssets) {
      const key = String(asset.scanId || '');
      if (!assetsByScan.has(key)) assetsByScan.set(key, []);
      assetsByScan.get(key).push(asset);
    }

    const updatePromises = scans.map((scan) => {
      const scanAssets = assetsByScan.get(String(scan._id)) || [];
      const scorecard = buildEnterpriseScorecard(scanAssets, [scan]);
      return Scan.findByIdAndUpdate(scan._id, { scorecard });
    });

    await Promise.all(updatePromises);

    const allScans = await Scan.find({ userId }).select('_id metadata report findings warnings createdAt updatedAt').lean();
    const allScanIds = allScans.map((scan) => scan._id);
    const allUserAssets = allScanIds.length ? await Asset.find({ scanId: { $in: allScanIds } }).lean() : [];
    const portfolioScorecard = buildPortfolioScorecard(allUserAssets, allScans);

    res.json({
      message: requestedScanId
        ? 'Requested scan recalculated and portfolio score refreshed'
        : 'Enterprise rating recalculated from all scans',
      scanId: '',
      scoreMax: ENTERPRISE_MAX_SCORE,
      scorecard: portfolioScorecard,
    });
  } catch (error) {
    next(error);
  }
}

export async function listRatingAssets(req, res, next) {
  try {
    const userId = getUserId(req);
    const scans = await Scan.find({ userId }).select('_id').lean();
    const scanIds = scans.map((scan) => scan._id);
    const assets = scanIds.length ? await Asset.find({ scanId: { $in: scanIds } }).lean() : [];

    const data = assets.map((asset) => ({
      assetId: asset._id,
      name: assetDisplayName(asset),
      score: resolveAssetScore(asset),
    }));

    res.json({ assets: data });
  } catch (error) {
    next(error);
  }
}