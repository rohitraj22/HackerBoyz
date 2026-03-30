import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../../config/env.js';
import { runCommand } from '../../utils/runCommand.js';
import { logger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveToolPath(toolPath) {
  return path.isAbsolute(toolPath)
    ? toolPath
    : path.resolve(__dirname, '../../../', toolPath);
}

function collectSourceFiles(rootDir, limit = 260) {
  const exts = new Set(['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.go', '.rb', '.php', '.cs', '.rs', '.c', '.cpp']);
  const files = [];
  const stack = [rootDir];

  while (stack.length && files.length < limit) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['.git', 'node_modules', 'dist', 'build', '.next'].includes(entry.name)) continue;
        stack.push(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (exts.has(ext)) {
        files.push(fullPath);
      }
      if (files.length >= limit) break;
    }
  }

  return files;
}

function runCryptoFallback(repoPath) {
  const files = collectSourceFiles(repoPath);
  const keyword = /crypto|cipher|tls|ssl|sha1|sha256|rsa|ecdsa|x25519|bcrypt|argon|certificate|openssl|jwt/i;
  const lines = [];

  for (const filePath of files) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const line of content.split(/\r?\n/)) {
      if (keyword.test(line)) {
        lines.push(`${path.basename(filePath)}: ${line.trim()}`);
      }
      if (lines.length >= 260) break;
    }
    if (lines.length >= 260) break;
  }

  return {
    raw: lines.length
      ? lines.join('\n')
      : 'No cryptography-related source code signals found in repository scan.',
    fallback: true,
  };
}

export async function runCryptoScanner(repoPath) {
  if (!repoPath) return { raw: '', skipped: true, reason: 'No repository path provided' };

  const executable = resolveToolPath(env.cryptoScanPath);
  if (!fs.existsSync(executable)) {
    logger.warn('Crypto scanner executable not found', { executable });
    return runCryptoFallback(repoPath);
  }

  const result = await runCommand(executable, ['scan', repoPath], {
    cwd: path.dirname(executable),
    allowNonZeroExit: true
  });

  const failureText = `${result.stderr || ''} ${result.stdout || ''}`.toLowerCase();
  if (Number(result.code) === 126 || /operation not permitted|permission denied|cannot execute|exec format error/.test(failureText)) {
    const fallback = runCryptoFallback(repoPath);
    return {
      ...fallback,
      reason:
        'Crypto scanner binary is not executable/incompatible on this OS. Used built-in source analysis as fallback.',
      stderr: result.stderr,
    };
  }

  return {
    raw: result.stdout || result.stderr || '',
    stderr: result.stderr
  };
}
