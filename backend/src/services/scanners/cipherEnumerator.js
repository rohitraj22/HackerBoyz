import { runCommand } from '../../utils/runCommand.js';
import tls from 'tls';

const SSL_LABS_API = 'https://api.ssllabs.com/api/v3/analyze';
const CIPHER_REGEX = /\b(TLS_[A-Z0-9_]+|[A-Z0-9-]+(?:_WITH_[A-Z0-9_]+)|[A-Z0-9-]+-AES[0-9]+-[A-Z0-9-]+|CHACHA20[-A-Z0-9_]*)\b/g;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractCipherNames(payload = {}) {
  const collected = new Set();
  const endpoints = Array.isArray(payload.endpoints) ? payload.endpoints : [];

  for (const endpoint of endpoints) {
    const suites = endpoint?.details?.suites;
    const list = Array.isArray(suites?.list) ? suites.list : [];

    for (const item of list) {
      const name = String(item?.name || '').trim();
      if (name) collected.add(name);
    }
  }

  return [...collected];
}

function normalizeCipherName(cipher = '') {
  return String(cipher || '')
    .trim()
    .replace(/^0x[0-9a-f,\s]+\s*-\s*/i, '');
}

function parseCiphersFromText(text = '') {
  const collected = new Set();
  const source = String(text || '');
  const matches = source.matchAll(CIPHER_REGEX);

  for (const match of matches) {
    const normalized = normalizeCipherName(match[1]);
    if (!normalized) continue;

    if (
      normalized.startsWith('TLS_') ||
      normalized.includes('_WITH_') ||
      normalized.includes('-AES') ||
      normalized.includes('CHACHA20')
    ) {
      collected.add(normalized);
    }
  }

  return [...collected];
}

async function commandExists(command) {
  try {
    const result = await runCommand('command', ['-v', command], {
      allowNonZeroExit: true,
    });
    return result.code === 0 && Boolean(String(result.stdout || '').trim());
  } catch {
    return false;
  }
}

async function collectWithNmap(hostname, port) {
  if (!(await commandExists('nmap'))) return [];

  try {
    const result = await runCommand(
      'nmap',
      ['--script', 'ssl-enum-ciphers', '-p', String(port || 443), hostname],
      { allowNonZeroExit: true }
    );
    return parseCiphersFromText(`${result.stdout || ''}\n${result.stderr || ''}`);
  } catch {
    return [];
  }
}

async function collectWithSslscan(hostname, port) {
  if (!(await commandExists('sslscan'))) return [];

  try {
    const target = `${hostname}:${String(port || 443)}`;
    const result = await runCommand('sslscan', ['--no-colour', target], {
      allowNonZeroExit: true,
    });
    return parseCiphersFromText(`${result.stdout || ''}\n${result.stderr || ''}`);
  } catch {
    return [];
  }
}

async function collectWithTestssl(hostname, port) {
  const hasTool = (await commandExists('testssl.sh')) || (await commandExists('testssl'));
  if (!hasTool) return [];

  const executable = (await commandExists('testssl.sh')) ? 'testssl.sh' : 'testssl';

  try {
    const target = `${hostname}:${String(port || 443)}`;
    const result = await runCommand(executable, ['--warnings', 'off', '--openssl-timeout', '4', target], {
      allowNonZeroExit: true,
    });
    return parseCiphersFromText(`${result.stdout || ''}\n${result.stderr || ''}`);
  } catch {
    return [];
  }
}

function buildNodeProbeCandidates() {
  const raw = tls
    .getCiphers()
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean);

  const preferred = raw.filter((cipher) =>
    /gcm|chacha20|aes/i.test(cipher)
  );
  const rest = raw.filter((cipher) => !preferred.includes(cipher));

  return [...new Set([...preferred, ...rest])].slice(0, 96);
}

async function probeSingleCipher(hostname, port, cipher) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        ciphers: cipher,
      },
      () => {
        try {
          const negotiated = normalizeCipherName(socket.getCipher()?.name || '');
          socket.end();
          resolve(negotiated || normalizeCipherName(cipher));
        } catch {
          socket.destroy();
          resolve('');
        }
      }
    );

    socket.setTimeout(1200, () => {
      socket.destroy();
      resolve('');
    });

    socket.on('error', () => resolve(''));
  });
}

async function collectWithNodeCipherProbing(hostname, port) {
  const candidates = buildNodeProbeCandidates();
  if (!candidates.length) return [];

  const accepted = new Set();
  const batchSize = 8;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((cipher) => probeSingleCipher(hostname, Number(port || 443), cipher)));
    for (const cipher of results) {
      if (cipher) accepted.add(cipher);
    }
  }

  return [...accepted];
}

async function getSslLabsCipherNames(hostname) {
  const host = encodeURIComponent(hostname);
  const baseQuery = `host=${host}&publish=off&startNew=off&all=done&fromCache=on&maxAge=24`;
  const maxAttempts = 4;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const payload = await fetchJsonWithTimeout(`${SSL_LABS_API}?${baseQuery}`);
    const status = String(payload?.status || '').toUpperCase();

    if (status === 'READY') {
      return extractCipherNames(payload);
    }

    if (status === 'ERROR') {
      return [];
    }

    await sleep(1200);
  }

  return [];
}

export async function enumerateServerCiphers(hostname, fallbackCiphers = [], port = 443) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) {
    return [...new Set(fallbackCiphers.filter(Boolean).map(normalizeCipherName))];
  }

  const merged = new Set(fallbackCiphers.filter(Boolean).map(normalizeCipherName));

  try {
    const [fromNmap, fromSslscan, fromTestssl] = await Promise.all([
      collectWithNmap(normalized, port),
      collectWithSslscan(normalized, port),
      collectWithTestssl(normalized, port),
    ]);

    for (const cipher of [...fromNmap, ...fromSslscan, ...fromTestssl]) {
      merged.add(normalizeCipherName(cipher));
    }
  } catch {
    // Continue with SSL Labs fallback.
  }

  // If local tools are unavailable or sparse, actively probe many TLS1.2 ciphers.
  if (merged.size < 4) {
    try {
      const fromNodeProbe = await collectWithNodeCipherProbing(normalized, port);
      for (const cipher of fromNodeProbe) merged.add(normalizeCipherName(cipher));
    } catch {
      // Ignore probing failures and continue.
    }
  }

  try {
    const fromAnalyzer = await getSslLabsCipherNames(normalized);
    for (const cipher of fromAnalyzer) merged.add(normalizeCipherName(cipher));
  } catch {
    // Keep scan resilient if analyzer is unavailable/rate-limited.
  }

  return [...merged].filter(Boolean);
}
