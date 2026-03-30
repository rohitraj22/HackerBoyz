export function parseDependencyOutput(raw = '') {
  const text = String(raw || '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const dependencies = [];
  for (const line of lines) {
    if (/openssl|rsa|ecdsa|x25519|sha1|sha256|tls|jwt|bcrypt|libsodium|crypto/i.test(line)) {
      dependencies.push(line);
    }
  }

  const normalized = dependencies.length ? dependencies : lines.slice(0, 20);

  return {
    raw,
    dependencies: normalized,
    findings: normalized.map((entry) => `Dependency signal: ${entry}`)
  };
}
