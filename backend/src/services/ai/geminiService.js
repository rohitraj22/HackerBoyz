import { env } from '../../config/env.js';
import { buildRecommendationPrompt } from './prompts.js';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractTextFromGeminiResponse(payload) {
  const candidates = payload?.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    const text = parts.map((part) => part?.text || '').join('\n').trim();
    if (text) return text;
  }
  return '';
}

function buildFallbackRecommendation({ risk }) {
  const executiveSummary =
    risk.riskLevel === 'Critical'
      ? 'The environment shows material quantum-readiness gaps and should enter immediate remediation planning.'
      : risk.riskLevel === 'High'
        ? 'The scan indicates meaningful migration risk and a structured remediation roadmap should begin now.'
        : risk.riskLevel === 'Moderate'
          ? 'The stack is reasonably modern but still has several areas that should be upgraded for long-term crypto agility.'
          : 'No severe gaps were detected in this scan, though migration planning and recurring review remain advisable.';

  return {
    executiveSummary,
    technicalRecommendations: [
      'Inventory every externally exposed TLS endpoint and validate supported protocol and cipher suite policy.',
      'Separate raw discovery from policy scoring so that future scanner upgrades do not break reporting.',
      'Track all certificate, key-exchange, and dependency findings in a durable CBOM record.'
    ],
    migrationPlan: [
      'Prioritize public-facing systems with the highest score and largest data-retention impact.',
      'Run staged testing for hybrid or post-quantum-capable migration paths in lower-risk environments first.',
      'Add recurring scans and compare deltas over time instead of treating readiness as a one-time exercise.'
    ],
    priorityActions: [
      'Confirm TLS version policy on all internet-facing assets.',
      'Audit classical signature and key exchange usage.',
      'Validate dependency inventory against approved crypto baselines.'
    ],
    rawModelOutput: {
      source: 'fallback'
    }
  };
}

export async function generateRecommendations({ inputs, risk, cbom }) {
  if (!env.geminiApiKey) {
    return buildFallbackRecommendation({ risk });
  }

  const prompt = buildRecommendationPrompt({ inputs, risk, cbom });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    return buildFallbackRecommendation({ risk });
  }

  const payload = await response.json();
  const text = extractTextFromGeminiResponse(payload);
  const parsed = safeJsonParse(text);

  if (!parsed) {
    return {
      ...buildFallbackRecommendation({ risk }),
      rawModelOutput: payload
    };
  }

  return {
    executiveSummary: parsed.executiveSummary || '',
    technicalRecommendations: Array.isArray(parsed.technicalRecommendations) ? parsed.technicalRecommendations : [],
    migrationPlan: Array.isArray(parsed.migrationPlan) ? parsed.migrationPlan : [],
    priorityActions: Array.isArray(parsed.priorityActions) ? parsed.priorityActions : [],
    rawModelOutput: payload
  };
}
