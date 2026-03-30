export function parseCryptoOutput(raw = '') {
  const text = String(raw || '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const categories = {
    hashing: [],
    tls: [],
    certificates: [],
    password: [],
    general: []
  };

  for (const line of lines) {
    if (/sha|hash/i.test(line)) categories.hashing.push(line);
    else if (/tls|ssl|cipher/i.test(line)) categories.tls.push(line);
    else if (/cert|certificate/i.test(line)) categories.certificates.push(line);
    else if (/bcrypt|argon|password/i.test(line)) categories.password.push(line);
    else categories.general.push(line);
  }

  const findings = Object.entries(categories)
    .flatMap(([category, values]) => values.map((value) => `[${category}] ${value}`));

  return {
    raw,
    categories,
    findings
  };
}
