import {Asset} from '../models/Asset.js';
import {Scan} from '../models/Scan.js';
import CBOMSnapshot from '../models/CBOMSnapshot.js';
import { isWeakCipher, isWeakProtocol, parseKeyLength } from '../utils/securityDerivation.js';
import { generateAiSummary } from '../services/ai/dashboardAiService.js';

function countBy(items, formatter) {
  const map = new Map();

  for (const item of items) {
    const key = formatter(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }

  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function bucketKeyLength(value) {
  const keyLength = parseKeyLength(value);
  if (!keyLength) return 'Unknown';
  if (keyLength < 2048) return '< 2048';
  if (keyLength === 2048) return '2048';
  if (keyLength <= 3072) return '3072';
  if (keyLength <= 4096) return '4096';
  return '> 4096';
}

async function buildCbomPayload({ userId = null, scanId = null } = {}) {
  let filter = {};

  if (scanId) {
    filter = { scanId };
  } else {
    const userScans = await Scan.find({ userId }).select('_id').lean();
    const scanIds = userScans.map((item) => item._id);

    if (!scanIds.length) {
      return {
        userId,
        scanId: null,
        totals: {
          applications: 0,
          certificates: 0,
          weakCryptography: 0,
          certificateIssues: 0,
        },
        keyLengthDistribution: [],
        cipherUsage: [],
        authorities: [],
        protocolDistribution: [],
        rows: [],
        aiSummary:
          'No scans are available yet for this account. Run a scan to build an overall CBOM across all scans.',
      };
    }

    filter = { scanId: { $in: scanIds } };
  }

  const assets = await Asset.find(filter).lean();

  const cryptoAssets = assets.filter(
    (asset) =>
      asset.tlsVersion ||
      asset.cipher ||
      asset.cipherSuite ||
      asset.certificateAuthority ||
      asset.commonName ||
      asset.keyLength
  );

  const uniqueApps = new Set(
    cryptoAssets.map((asset) => asset.appName || asset.hostname || asset.domain || asset.name).filter(Boolean)
  );

  const totals = {
    applications: uniqueApps.size,
    certificates: cryptoAssets.filter((a) => a.certificateAuthority || a.commonName || a.validTo).length,
    weakCryptography: cryptoAssets.filter(
      (a) => isWeakProtocol(a.tlsVersion || a.protocol) || isWeakCipher(a.cipherSuite || a.cipher)
    ).length,
    certificateIssues: cryptoAssets.filter((a) => {
      const validTo = a.validTo ? new Date(a.validTo) : null;
      return validTo && validTo.getTime() < Date.now();
    }).length,
  };

  const keyLengthDistribution = countBy(cryptoAssets, (a) => bucketKeyLength(a.keyLength)).slice(0, 8);
  const cipherUsage = countBy(cryptoAssets, (a) => a.cipherSuite || a.cipher || '').slice(0, 8);
  const authorities = countBy(cryptoAssets, (a) => a.certificateAuthority || '').slice(0, 8);
  const protocolDistribution = countBy(cryptoAssets, (a) => a.tlsVersion || a.protocol || '').slice(0, 8);

  const rows = cryptoAssets.slice(0, 25).map((asset) => ({
    application: asset.appName || asset.hostname || asset.domain || asset.name || '-',
    keyLength: asset.keyLength || '-',
    cipher: asset.cipherSuite || asset.cipher || '-',
    certificateAuthority: asset.certificateAuthority || '-',
    tlsVersion: asset.tlsVersion || asset.protocol || '-',
  }));

  const aiSummary = await generateAiSummary({
    title: 'CBOM Summary',
    facts: [
      `Applications represented: ${totals.applications}`,
      `Certificates identified: ${totals.certificates}`,
      `Weak cryptography items: ${totals.weakCryptography}`,
      `Certificate issues: ${totals.certificateIssues}`,
      `Most common protocol: ${protocolDistribution[0]?.label || 'Unknown'}`,
      `Most common cipher: ${cipherUsage[0]?.label || 'Unknown'}`,
    ],
    fallback:
      `The current CBOM shows ${totals.certificates} certificates across ${totals.applications} applications. ` +
      `${totals.weakCryptography} items appear to use weak protocols or ciphers, so remediation should start with those assets first.`,
  });

  return {
    userId,
    scanId,
    totals,
    keyLengthDistribution,
    cipherUsage,
    authorities,
    protocolDistribution,
    rows,
    aiSummary,
  };
}

export async function getLatestCbom(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const latest = await CBOMSnapshot.findOne({ userId, scanId: null })
      .sort({ createdAt: -1 })
      .lean();

    if (latest && req.query.refresh !== 'true') {
      return res.json(latest);
    }

    const payload = await buildCbomPayload({ userId, scanId: null });

    const snapshot = await CBOMSnapshot.create(payload);
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
}

export async function getCbomByScan(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const { scanId } = req.params;

    const scan = await Scan.findOne({ _id: scanId, userId }).lean();
    if (!scan) {
      return res.status(404).json({ message: 'Scan not found' });
    }

    const existing = await CBOMSnapshot.findOne({ userId, scanId })
      .sort({ createdAt: -1 })
      .lean();
    if (existing) return res.json(existing);

    const payload = await buildCbomPayload({ userId, scanId });
    const snapshot = await CBOMSnapshot.create(payload);
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
}

export async function rebuildCbom(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const { scanId } = req.params;

    let payload;
    if (scanId === 'overall') {
      payload = await buildCbomPayload({ userId, scanId: null });
    } else {
      const scan = await Scan.findOne({ _id: scanId, userId }).lean();
      if (!scan) {
        return res.status(404).json({ message: 'Scan not found' });
      }
      payload = await buildCbomPayload({ userId, scanId });
    }

    const snapshot = await CBOMSnapshot.create(payload);
    res.json({
      message: 'CBOM rebuilt successfully',
      snapshot,
    });
  } catch (error) {
    next(error);
  }
}