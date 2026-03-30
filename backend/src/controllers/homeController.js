import { Asset } from '../models/Asset.js';
import { Scan } from '../models/Scan.js';
import { Recommendation } from '../models/Recommendation.js';
import {
  inferAssetType,
  deriveSeverity,
} from '../utils/securityDerivation.js';
import { generateAiSummary } from '../services/ai/dashboardAiService.js';

export async function getHomeSummary(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const allUserScans = await Scan.find({ userId }).lean();
    const allUserScanIds = allUserScans.map((scan) => scan._id);

    const assets = await Asset.find({ scanId: { $in: allUserScanIds } }).lean();
    const recentScans = await Scan.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const topRecommendations = await Recommendation.find({ scanId: { $in: allUserScanIds } })
      .sort({ priority: -1, createdAt: -1 })
      .limit(5)
      .lean();

    const averageScore = allUserScans.length
      ? Math.round(
          allUserScans.reduce((sum, scan) => sum + (Number(scan.overallRiskScore) || 0), 0) /
            allUserScans.length
        )
      : 0;

    const counts = {
      totalAssets: assets.length,
      totalScans: allUserScans.length,
      averageScore,
      publicWebApps: 0,
      apis: 0,
      servers: 0,
      expiringCertificates: 0,
      highRiskAssets: 0,
    };

    const scanSeverityBreakdown = {
      critical: 0,
      high: 0,
      moderate: 0,
      low: 0,
    };

    for (const scan of allUserScans) {
      const level = String(scan.riskLevel || '').toLowerCase();
      if (scanSeverityBreakdown[level] !== undefined) {
        scanSeverityBreakdown[level] += 1;
      }
    }

    const now = Date.now();
    const certWindow = 30 * 24 * 60 * 60 * 1000;

    for (const asset of assets) {
      const type = inferAssetType(asset);
      const severity = deriveSeverity(asset);

      if (type === 'domain' || type === 'webapp') counts.publicWebApps += 1;
      if (type === 'api') counts.apis += 1;
      if (type === 'ip' || type === 'server') counts.servers += 1;

      if (severity === 'critical' || severity === 'high') counts.highRiskAssets += 1;
      const validTo = asset.validTo ? new Date(asset.validTo).getTime() : null;
      if (validTo && validTo >= now && validTo <= now + certWindow) {
        counts.expiringCertificates += 1;
      }
    }

    const scoreTrend = recentScans
      .slice()
      .reverse()
      .map((scan) => ({
        label: scan.name || scan.target || scan.createdAt?.toISOString?.() || 'Scan',
        value: scan?.overallRiskScore ?? 0,
      }));

    const aiSummary = await generateAiSummary({
      title: 'Home Dashboard',
      facts: [
        `Total assets: ${counts.totalAssets}`,
        `Public web apps: ${counts.publicWebApps}`,
        `APIs: ${counts.apis}`,
        `Servers: ${counts.servers}`,
        `Expiring certificates in next 30 days: ${counts.expiringCertificates}`,
        `High risk assets: ${counts.highRiskAssets}`,
        `Critical scans: ${scanSeverityBreakdown.critical}`,
        `High scans: ${scanSeverityBreakdown.high}`,
        `Moderate scans: ${scanSeverityBreakdown.moderate}`,
        `Low scans: ${scanSeverityBreakdown.low}`,
      ],
      fallback:
        `The platform currently tracks ${counts.totalAssets} assets with ${counts.highRiskAssets} high-risk items requiring attention. ` +
        `${counts.expiringCertificates} certificates are approaching expiry, and the current severity distribution suggests prioritizing critical and high-risk remediation first.`,
    });

    res.json({
      kpis: counts,
      severityBreakdown: scanSeverityBreakdown,
      recentScans,
      topRecommendations,
      scoreTrend,
      aiSummary,
    });
  } catch (error) {
    next(error);
  }
}