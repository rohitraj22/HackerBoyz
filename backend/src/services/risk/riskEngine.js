function containsAny(text, values) {
  return values.some((value) => String(text).toLowerCase().includes(value.toLowerCase()));
}

function getRiskLevel(score) {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

export function calculateRisk({
  tls = {},
  dependency = {},
  crypto = {},
  api = {},
  apiTargetProvided = false
}) {
  let riskPoints = 0;
  const findings = [];

  const tlsVersion = String(tls.tlsVersion || api.tlsVersion || '').toLowerCase();
  const cipher = String(tls.cipher || api.cipher || '').toLowerCase();
  const keyExchange = String(tls.keyExchange || api.keyExchange || '').toLowerCase();
  const signature = String(tls.signature || api.signature || '').toLowerCase();

  if (tlsVersion.includes('1.0')) {
    riskPoints += 40;
    findings.push('TLS 1.0 detected.');
  } else if (tlsVersion.includes('1.1')) {
    riskPoints += 30;
    findings.push('TLS 1.1 detected.');
  } else if (tlsVersion.includes('1.2')) {
    riskPoints += 10;
    findings.push('TLS 1.2 detected.');
  } else if (tlsVersion.includes('1.3')) {
    findings.push('TLS 1.3 detected.');
  }

  if (containsAny(keyExchange, ['rsa'])) {
    riskPoints += 25;
    findings.push('RSA-based key exchange or signaling detected.');
  }

  if (containsAny(keyExchange, ['ecdhe', 'x25519'])) {
    riskPoints += 20;
    findings.push('Classical elliptic-curve key exchange detected, which is not post-quantum safe by itself.');
  }

  if (containsAny(signature, ['rsa', 'ecdsa', 'sha1'])) {
    riskPoints += 20;
    findings.push('Classical signature usage detected.');
  }

  if (containsAny(cipher, ['cbc'])) {
    riskPoints += 10;
    findings.push('CBC-mode cipher usage detected.');
  }

  const dependencyText = JSON.stringify(dependency.dependencies || []).toLowerCase();
  if (containsAny(dependencyText, ['openssl'])) {
    riskPoints += 10;
    findings.push('OpenSSL dependency detected; validate version and PQ readiness.');
  }
  if (containsAny(dependencyText, ['rsa', 'ecdsa'])) {
    riskPoints += 10;
    findings.push('Repository dependencies reference classical public-key cryptography.');
  }

  const cryptoText = JSON.stringify(crypto.findings || []).toLowerCase();
  if (containsAny(cryptoText, ['sha1'])) {
    riskPoints += 15;
    findings.push('SHA-1-like crypto signal detected.');
  }
  if (containsAny(cryptoText, ['bcrypt'])) {
    findings.push('Password hashing signal detected; this is not itself a PQ issue but should be reviewed for policy alignment.');
  }
  if (containsAny(cryptoText, ['certificate'])) {
    riskPoints += 5;
    findings.push('Certificate-handling code detected and should be audited for migration readiness.');
  }

  const apiStatus = Number(api.statusCode || 0);
  if (apiTargetProvided && (apiStatus >= 400 || apiStatus === 0)) {
    riskPoints += 5;
    findings.push('API endpoint was unreachable or returned an error during scan.');
  }

  riskPoints = Math.max(0, Math.min(100, riskPoints));
  const riskLevel = getRiskLevel(riskPoints);
  const safetyScore = 100 - riskPoints;

  const summary =
    riskLevel === 'Critical'
      ? 'High-confidence quantum-readiness gaps were detected and should be triaged immediately.'
      : riskLevel === 'High'
        ? 'Several meaningful migration risks were identified and should be prioritized.'
        : riskLevel === 'Moderate'
          ? 'The environment appears modern but still carries some crypto migration debt.'
          : 'No major high-risk findings were detected in this scan, though continued validation is recommended.';

  return {
    score: safetyScore,
    riskPoints,
    riskLevel,
    findings,
    summary
  };
}
