import * as geminiService from './geminiService.js';

async function tryKnownGeminiMethods(prompt) {
  const possibleFns = [
    geminiService.generateText,
    geminiService.askGemini,
    geminiService.generateGeminiText,
    geminiService.default,
  ].filter(Boolean);

  for (const fn of possibleFns) {
    if (typeof fn === 'function') {
      const result = await fn(prompt);

      if (typeof result === 'string') return result.trim();
      if (result?.text) return String(result.text).trim();
      if (result?.response?.text) return String(result.response.text).trim();
    }
  }

  return null;
}

export async function generateAiSummary({ title, facts = [], fallback, style = 'default', extraInstructions = '' }) {
  try {
    const styleInstructions =
      style === 'pqc-target'
        ? `
Write exactly 4 concise bullet points.
Each bullet must contain:
- one specific finding from the facts
- one concrete remediation action
- an execution window (Immediate, 30 days, 60-90 days, Ongoing)
Avoid generic wording like "improve security posture" without specifics.
`
        : style === 'pqc-dashboard'
        ? `
Write exactly 6 prioritized bullet points for security leadership.
Each bullet must include:
- one observed signal from the facts (grade/risk/tls/cipher/key/exposure)
- one concrete remediation action
- one owner role (Platform, Network, AppSec, Certificate Ops, Dev Team)
- one timeline (Immediate, 30 days, 60-90 days, Ongoing)
Use practical language and include explicit protocol/cipher/key upgrades where relevant.
Do not repeat the same action in multiple bullets.
`
        : 'Keep it to 4-6 sentences and make it action-oriented.';

    const prompt = `
You are a cybersecurity reporting assistant.
Write a concise executive summary for "${title}".
Use only the facts below. Do not invent facts.
${styleInstructions}
${extraInstructions}

Facts:
${facts.map((fact, idx) => `${idx + 1}. ${fact}`).join('\n')}
    `.trim();

    const text = await tryKnownGeminiMethods(prompt);
    return text || fallback;
  } catch (error) {
    return fallback;
  }
}