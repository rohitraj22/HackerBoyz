function isQuantumSafeSignal(text = '') {
  const value = String(text || '').toLowerCase();
  return (
    value.includes('ml-kem') ||
    value.includes('kyber') ||
    value.includes('ml-dsa') ||
    value.includes('dilithium') ||
    value.includes('falcon') ||
    value.includes('sphincs')
  );
}

function deriveQuantumSafeFromAssetSignals({ keyExchange = '', signature = '', cipher = '' }) {
  if (isQuantumSafeSignal(keyExchange) || isQuantumSafeSignal(signature) || isQuantumSafeSignal(cipher)) {
    return true;
  }
  if (!keyExchange && !signature && !cipher) {
    return null;
  }
  return false;
}

function deriveQuantumSafeFromRisk({ riskLevel = '', score = 0 }) {
  const normalizedLevel = String(riskLevel || '').toLowerCase();
  const numericScore = Number(score) || 0;

  if (normalizedLevel === 'low' || numericScore >= 75) {
    return true;
  }

  if (normalizedLevel === 'moderate' || (numericScore >= 50 && numericScore < 75)) {
    return null;
  }

  return false;
}

export function generateCBOM({ inputs, tls, dependency, crypto, api, risk }) {
  const assets = [];

  if (inputs.domain) {
    assets.push({
      asset_type: 'domain',
      target: inputs.domain,
      tls_version: tls.tlsVersion || '',
      cipher: tls.cipher || '',
      key_exchange: tls.keyExchange || '',
      signature: tls.signature || '',
      issuer: tls.issuer || '',
      quantum_safe: deriveQuantumSafeFromRisk({ riskLevel: risk.riskLevel, score: risk.score }),
      findings: tls.findings || []
    });
  }

  if (inputs.apiEndpoint) {
    assets.push({
      asset_type: 'api',
      target: inputs.apiEndpoint,
      tls_version: api.tlsVersion || '',
      cipher: api.cipher || '',
      key_exchange: api.keyExchange || '',
      signature: api.signature || '',
      issuer: api.issuer || '',
      http_status_code: api.statusCode || 0,
      quantum_safe: deriveQuantumSafeFromRisk({ riskLevel: risk.riskLevel, score: risk.score })
    });
  }

  return {
    version: '1.0.0',
    scanned_at: new Date().toISOString(),
    inputs,
    overall_risk_score: risk.score,
    risk_level: risk.riskLevel,
    findings: risk.findings,
    assets
  };
}
