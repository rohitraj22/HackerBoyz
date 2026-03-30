function pickFirstMatch(text, regexList) {
  for (const regex of regexList) {
    const match = text.match(regex);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function pickAllMatches(text, regexList) {
  const values = [];

  for (const regex of regexList) {
    const source = regex.source;
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    const globalRegex = new RegExp(source, flags);
    let match;

    while ((match = globalRegex.exec(text)) !== null) {
      const value = (match?.[1] || '').trim();
      if (value) values.push(value);
    }
  }

  return [...new Set(values)];
}

function normalizeCipherValues(values = []) {
  const flattened = values.flatMap((value) =>
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );

  return [...new Set(flattened)];
}

export function parseTLSOutput(raw = '') {
  const text = String(raw || '');
  const tlsVersion = pickFirstMatch(text, [
    /TLS\s*Version\s*[:=-]\s*([^\n\r]+)/i,
    /Protocol\s*[:=-]\s*([^\n\r]+)/i,
    /(TLSv?1\.[0-3])/i
  ]);
  const ciphers = normalizeCipherValues(pickAllMatches(text, [
    /Cipher(?:\s*Suite)?(?:s)?\s*[:=-]\s*([^\n\r]+)/i,
    /(TLS_[A-Z0-9_]+)/i,
  ]));
  const cipher = ciphers.join(', ');
  const keyExchange = pickFirstMatch(text, [
    /Key\s*Exchange\s*[:=-]\s*([^\n\r]+)/i,
    /(X25519|ECDHE|RSA|DHE)/i
  ]);
  const signature = pickFirstMatch(text, [
    /Signature(?:\s*Algorithm)?\s*[:=-]\s*([^\n\r]+)/i,
    /(ECDSA[-\w]*|SHA256-RSA|RSA|ML-DSA|SLH-DSA)/i
  ]);
  const issuer = pickFirstMatch(text, [
    /Issuer\s*[:=-]\s*([^\n\r]+)/i
  ]);
  const commonName = pickFirstMatch(text, [
    /Common\s*Name\s*[:=-]\s*([^\n\r]+)/i,
    /Subject\s*CN\s*[:=-]\s*([^\n\r]+)/i,
    /CN\s*=\s*([^,\n\r]+)/i,
  ]);
  const fingerprint = pickFirstMatch(text, [
    /SSL\s*SHA\s*Fingerprint\s*[:=-]\s*([^\n\r]+)/i,
    /Fingerprint(?:256)?\s*[:=-]\s*([^\n\r]+)/i,
  ]);

  const findings = [];
  if (!tlsVersion) findings.push('Unable to confidently parse TLS version from scanner output.');
  if (!cipher) findings.push('Unable to confidently parse cipher suite from scanner output.');
  if (!keyExchange) findings.push('Unable to confidently parse key exchange from scanner output.');
  if (!signature) findings.push('Unable to confidently parse signature algorithm from scanner output.');

  return {
    raw,
    tlsVersion,
    cipher,
    ciphers,
    keyExchange,
    signature,
    issuer,
    commonName,
    fingerprint,
    findings
  };
}
