export function generateReport({ scan, recommendation }) {
  return {
    title: 'Quantum Security Scan Report',
    generatedAt: new Date().toISOString(),
    executiveSummary: recommendation.executiveSummary,
    securityScore: scan.overallRiskScore,
    riskLevel: scan.riskLevel,
    findings: scan.findings,
    recommendedActions: recommendation.priorityActions,
    migrationPlan: recommendation.migrationPlan,
    technicalRecommendations: recommendation.technicalRecommendations
  };
}

export function generateMarkdownReport({ scan, recommendation }) {
  return `# Quantum Security Scan Report

## Executive Summary
${recommendation.executiveSummary || 'No summary available.'}

## Overall Risk
- Security Score (0 unsafe, 100 safest): ${scan.overallRiskScore}
- Level: ${scan.riskLevel}

## Findings
${(scan.findings || []).map((item) => `- ${item}`).join('\n') || '- No findings'}

## Priority Actions
${(recommendation.priorityActions || []).map((item) => `- ${item}`).join('\n') || '- No actions'}

## Migration Plan
${(recommendation.migrationPlan || []).map((item) => `- ${item}`).join('\n') || '- No migration items'}

## Technical Recommendations
${(recommendation.technicalRecommendations || []).map((item) => `- ${item}`).join('\n') || '- No technical recommendations'}
`;
}
