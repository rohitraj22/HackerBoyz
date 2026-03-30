import { Scan } from '../models/Scan.js';
import { Recommendation } from '../models/Recommendation.js';
import { generateMarkdownReport } from '../services/reports/reportGenerator.js';
import { generateRecommendations } from '../services/ai/geminiService.js';
import { successResponse } from '../utils/responseFormatter.js';

export async function getCBOM(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const scan = await Scan.findOne({ _id: req.params.id, userId }).lean();
    if (!scan) {
      return res.status(404).json({ success: false, message: 'Scan not found' });
    }

    return res.json(successResponse(scan.cbom));
  } catch (error) {
    next(error);
  }
}

export async function getReport(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const [scan, recommendation] = await Promise.all([
      Scan.findOne({ _id: req.params.id, userId }).lean(),
      Recommendation.findOne({ scanId: req.params.id }).lean()
    ]);

    if (!scan) {
      return res.status(404).json({ success: false, message: 'Scan not found' });
    }

    const markdown = generateMarkdownReport({
      scan,
      recommendation: recommendation || {
        executiveSummary: '',
        priorityActions: [],
        migrationPlan: [],
        technicalRecommendations: []
      }
    });

    return res.json(successResponse({
      report: scan.report,
      markdown
    }));
  } catch (error) {
    next(error);
  }
}

export async function regenerateRecommendation(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id || null;
    const scan = await Scan.findOne({ _id: req.params.scanId, userId });
    if (!scan) {
      return res.status(404).json({ success: false, message: 'Scan not found' });
    }

    const recommendationPayload = await generateRecommendations({
      inputs: {
        domain: scan.domain,
        apiEndpoint: scan.apiEndpoint
      },
      risk: {
        score: scan.overallRiskScore,
        riskLevel: scan.riskLevel,
        findings: scan.findings,
        summary: scan.summary
      },
      cbom: scan.cbom
    });

    const recommendation = await Recommendation.findOneAndUpdate(
      { scanId: scan._id },
      {
        scanId: scan._id,
        generatedBy: 'gemini',
        executiveSummary: recommendationPayload.executiveSummary,
        technicalRecommendations: recommendationPayload.technicalRecommendations,
        migrationPlan: recommendationPayload.migrationPlan,
        priorityActions: recommendationPayload.priorityActions,
        rawModelOutput: recommendationPayload.rawModelOutput || {}
      },
      { new: true, upsert: true }
    ).lean();

    return res.json(successResponse(recommendation, 'Recommendations regenerated successfully'));
  } catch (error) {
    next(error);
  }
}
