import fs from 'fs';
import path from 'path';
import tls from 'tls';
import { fileURLToPath } from 'url';
import { env } from '../../config/env.js';
import { runCommand } from '../../utils/runCommand.js';
import { logger } from '../../utils/logger.js';
import { enumerateServerCiphers } from './cipherEnumerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveToolPath(toolPath) {
  return path.isAbsolute(toolPath)
    ? toolPath
    : path.resolve(__dirname, '../../../', toolPath);
}

function toTlsProbeRaw({
  tlsVersion = '',
  ciphers = [],
  keyExchange = '',
  signature = '',
  issuer = '',
  commonName = '',
  fingerprint = '',
}) {
  const cipherText = Array.isArray(ciphers) ? ciphers.filter(Boolean).join(', ') : '';
  return [
    `TLS Version: ${tlsVersion}`,
    `Cipher Suite: ${cipherText}`,
    `Key Exchange: ${keyExchange}`,
    `Signature Algorithm: ${signature}`,
    `Issuer: ${issuer}`,
    `Common Name: ${commonName}`,
    `SSL SHA Fingerprint: ${fingerprint}`,
  ].join('\n');
}

async function enrichRawWithCipherEnumeration(domain, raw = '') {
  const baseText = String(raw || '');
  const inlineCiphers = [
    ...baseText.matchAll(/(TLS_[A-Z0-9_]+)/gi),
    ...baseText.matchAll(/\b([A-Z0-9-]+(?:_WITH_[A-Z0-9_]+)?)\b/g),
  ]
    .map((match) => String(match[1] || '').trim())
    .filter((value) =>
      value.startsWith('TLS_') ||
      value.includes('_WITH_') ||
      value.includes('-AES') ||
      value.includes('CHACHA20')
    );

  const ciphers = await enumerateServerCiphers(domain, inlineCiphers, 443);
  if (!ciphers.length) return baseText;

  const cipherLine = `Cipher Suites: ${ciphers.join(', ')}`;
  if (/Cipher\s*Suites?\s*[:=-]/i.test(baseText)) {
    return baseText.replace(/Cipher\s*Suites?\s*[:=-]\s*[^\n\r]*/i, cipherLine);
  }

  return `${cipherLine}\n${baseText}`.trim();
}

async function runNativeTlsProbe(domain) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: domain,
        port: 443,
        servername: domain,
        rejectUnauthorized: false,
      },
      async () => {
        try {
          const cipher = socket.getCipher() || {};
          const certificate = socket.getPeerCertificate() || {};
          const ephemeral = socket.getEphemeralKeyInfo?.() || {};
          const ciphers = [cipher.name, cipher.standardName].filter(Boolean);

          const raw = toTlsProbeRaw({
              tlsVersion: socket.getProtocol() || '',
              ciphers,
              keyExchange:
                ephemeral.name ||
                ephemeral.type ||
                cipher.kx ||
                '',
              signature: certificate.signatureAlgorithm || '',
              issuer: certificate?.issuer?.O || certificate?.issuer?.CN || '',
              commonName: certificate?.subject?.CN || '',
              fingerprint: certificate?.fingerprint256 || certificate?.fingerprint || '',
            });

          const enrichedRaw = await enrichRawWithCipherEnumeration(domain, raw);
          resolve({ raw: enrichedRaw, fallback: true });
        } catch {
          resolve({
            raw: '',
            skipped: true,
            reason:
              'TLS analyzer execution failed and native TLS probe could not parse scanner output.',
          });
        } finally {
          socket.end();
        }
      }
    );

    socket.setTimeout(8000, () => {
      socket.destroy();
      resolve({
        raw: '',
        skipped: true,
        reason:
          'TLS analyzer execution failed and native TLS probe timed out for the provided domain.',
      });
    });

    socket.on('error', () => {
      resolve({
        raw: '',
        skipped: true,
        reason:
          'TLS analyzer execution failed and native TLS probe could not establish a TLS connection to the provided domain.',
      });
    });
  });
}

export async function runTLSScanner(domain) {
  if (!domain) return { raw: '', skipped: true, reason: 'No domain provided' };

  const executable = resolveToolPath(env.tlsAnalyzerPath);
  if (!fs.existsSync(executable)) {
    logger.warn('TLS analyzer executable not found', { executable });
    return runNativeTlsProbe(domain);
  }

  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    logger.warn('TLS analyzer is not executable on this machine', { executable });
    return runNativeTlsProbe(domain);
  }

  try {
    const result = await runCommand(executable, [domain], { cwd: path.dirname(executable) });
    const enrichedRaw = await enrichRawWithCipherEnumeration(domain, result.stdout || result.stderr || '');
    return {
      raw: enrichedRaw,
      stderr: result.stderr
    };
  } catch (error) {
    logger.warn('TLS analyzer execution failed', {
      executable,
      message: error?.message,
      stderr: error?.stderr,
    });

    return runNativeTlsProbe(domain);
  }
}
