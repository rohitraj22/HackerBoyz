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

function collectManifestFiles(rootDir, limit = 120) {
  const wanted = new Set([
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'requirements.txt',
    'poetry.lock',
    'pipfile',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'cargo.toml',
    'gemfile',
  ]);

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

      if (wanted.has(entry.name.toLowerCase())) {
        files.push(fullPath);
      }
      if (files.length >= limit) break;
    }
  }

  return files;
}

function runDependencyFallback(repoPath) {
  const manifests = collectManifestFiles(repoPath);
  const keyword = /openssl|rsa|ecdsa|x25519|sha1|sha256|tls|ssl|jwt|bcrypt|argon|libsodium|crypto/i;
  const lines = [];

  for (const filePath of manifests) {
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
      if (lines.length >= 200) break;
    }
    if (lines.length >= 200) break;
  }

  return {
    raw: lines.length
      ? lines.join('\n')
      : 'No cryptography-related dependency signals found in repository manifests.',
    fallback: true,
  };
}

export async function runDependencyScanner(repoPath) {
  if (!repoPath) return { raw: '', skipped: true, reason: 'No repository path provided' };

  const executable = resolveToolPath(env.cryptoDepsPath);
  if (!fs.existsSync(executable)) {
    logger.warn('Dependency scanner executable not found', { executable });
    return runDependencyFallback(repoPath);
  }

  const result = await runCommand(executable, [repoPath], { cwd: path.dirname(executable), allowNonZeroExit: true });

  const failureText = `${result.stderr || ''} ${result.stdout || ''}`.toLowerCase();
  if (Number(result.code) === 126 || /operation not permitted|permission denied|cannot execute|exec format error/.test(failureText)) {
    const fallback = runDependencyFallback(repoPath);
    return {
      ...fallback,
      reason:
        'Dependency scanner binary is not executable/incompatible on this OS. Used built-in repository manifest analysis as fallback.',
      stderr: result.stderr,
    };
  }

  return {
    raw: result.stdout || result.stderr || '',
    stderr: result.stderr
  };
}
