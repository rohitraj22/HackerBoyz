import { Scan } from '../models/Scan.js';
import { Asset } from '../models/Asset.js';
import { Recommendation } from '../models/Recommendation.js';
import { runFullScan } from '../services/scanners/scanOrchestrator.js';
import { generateReport } from '../services/reports/reportGenerator.js';
import { successResponse } from '../utils/responseFormatter.js';

export async function runScan(req, res, next) {
  try {
    const { domain = '', apiEndpoint = '' } = req.body || {};

    if (!domain && !apiEndpoint) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one target: domain or apiEndpoint.'
      });
    }

    const result = await runFullScan({ domain, apiEndpoint });

    const scan = await Scan.create({
      userId: req.user?._id || req.user?.id || null,
      domain,
      apiEndpoint,
      status: 'completed',
      summary: result.summary,
      overallRiskScore: result.overallRiskScore,
      riskLevel: result.riskLevel,
      findings: result.findings,
      warnings: result.warnings,
      cbom: result.cbom
    });

    const assets = await Asset.insertMany(
      result.assets.map((asset) => ({
        scanId: scan._id,
        ...asset
      }))
    );

    const recommendation = await Recommendation.create({
      scanId: scan._id,
      generatedBy: 'gemini',
      executiveSummary: result.recommendation.executiveSummary,
      technicalRecommendations: result.recommendation.technicalRecommendations,
      migrationPlan: result.recommendation.migrationPlan,
      priorityActions: result.recommendation.priorityActions,
      rawModelOutput: result.recommendation.rawModelOutput || {}
    });

    const report = generateReport({ scan, recommendation });
    scan.report = report;
    await scan.save();

    return res.status(201).json(
      successResponse({
        scan,
        assets,
        recommendation,
        report,
        raw: result.raw
      }, 'Scan completed successfully')
    );
  } catch (error) {
    const message = String(error?.message || 'Scan failed');

    if (/exit code 126|not executable|permission denied|enoent|command not found/i.test(message)) {
      error.statusCode = 400;
      error.message =
        'Scanner tool execution failed: One or more scanner binaries are missing, not executable, or incompatible with this OS. Configure valid binaries and permissions, or run scan without that target type.';
    } else if (/network|fetch failed|timeout|ENOTFOUND|ECONNREFUSED/i.test(message)) {
      error.statusCode = 502;
      error.message =
        'Scan failed due to an external network/service issue. Check internet connectivity, target reachability, and retry.';
    } else {
      error.statusCode = error.statusCode || 500;
      error.message =
        `Scan could not be completed. Root cause: ${message}. ` +
        'Please validate input URLs and scanner configuration, then retry.';
    }

    next(error);
  }
}

export async function getScanById(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const scan = await Scan.findOne({ _id: req.params.id, userId }).lean();
    if (!scan) {
      return res.status(404).json({ success: false, message: 'Scan not found' });
    }

    const [assets, recommendation] = await Promise.all([
      Asset.find({ scanId: scan._id }).lean(),
      Recommendation.findOne({ scanId: scan._id }).lean()
    ]);

    return res.json(successResponse({ scan, assets, recommendation }));
  } catch (error) {
    next(error);
  }
}

export async function listScans(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const scans = await Scan.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json(successResponse(scans));
  } catch (error) {
    next(error);
  }
}

export async function deleteScan(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const scan = await Scan.findOne({ _id: req.params.id, userId });
    if (!scan) {
      return res.status(404).json({ success: false, message: 'Scan not found' });
    }

    await Promise.all([
      Asset.deleteMany({ scanId: scan._id }),
      Recommendation.deleteMany({ scanId: scan._id }),
      Scan.findByIdAndDelete(scan._id)
    ]);

    return res.json(successResponse(null, 'Scan deleted successfully'));
  } catch (error) {
    next(error);
  }
}
