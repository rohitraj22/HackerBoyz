export function buildRecommendationPrompt({ inputs, risk, cbom }) {
  return `
You are a security architect reviewing public-facing application cryptography for quantum-migration readiness.

Your task:
1. Write a concise executive summary.
2. Provide technical recommendations.
3. Provide a practical migration plan.
4. Provide a short list of highest-priority actions.

Return valid JSON only in this shape:
{
  "executiveSummary": "string",
  "technicalRecommendations": ["string"],
  "migrationPlan": ["string"],
  "priorityActions": ["string"]
}

Inputs:
${JSON.stringify(inputs, null, 2)}

Risk:
${JSON.stringify(risk, null, 2)}

CBOM:
${JSON.stringify(cbom, null, 2)}
`.trim();
}
