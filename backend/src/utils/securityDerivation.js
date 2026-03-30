import mongoose from 'mongoose';

const normalize = (value) => String(value || '').trim().toLowerCase();

export function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseKeyLength(value) {
  if (typeof value === 'number') return value > 0 ? value : 0;
  if (!value) return 0;

  const matches = String(value).match(/\d{2,5}/g) || [];
  const candidates = matches
    .map((item) => Number(item))
    .filter((num) => Number.isFinite(num) && num >= 128 && num <= 16384);

  if (!candidates.length) return 0;
  return Math.max(...candidates);
}

export function inferAssetType(asset = {}) {
  const explicit = normalize(asset.assetType || asset.type);
  if (explicit) return explicit;

  if (asset.certificateAuthority || asset.commonName || asset.validTo) return 'certificate';
  if (asset.softwareName || asset.softwareVersion || asset.product) return 'software';
  if (asset.apiPath || asset.isApi || /\/api/i.test(asset.url || '')) return 'api';
  if (asset.ipAddress || asset.subnet) return 'ip';
  if (asset.hostname || asset.domain || asset.registrar) return 'domain';

  return 'unknown';
}

export function assetDisplayName(asset = {}) {
  return (
    asset.name ||
    asset.hostname ||
    asset.domain ||
    asset.commonName ||
    asset.softwareName ||
    asset.ipAddress ||
    asset.url ||
    asset._id?.toString() ||
    'Unknown Asset'
  );
}

export function isWeakProtocol(protocol = '') {
  const p = normalize(protocol);
  return p.includes('ssl') || p.includes('1.0') || p.includes('1.1');
}

export function isWeakCipher(cipher = '') {
  const c = normalize(cipher);
  return ['3des', 'rc4', 'des', 'md5', 'sha1', 'cbc'].some((bad) => c.includes(bad));
}

export function isModernCipher(cipher = '') {
  const c = normalize(cipher);
  return ['aes_128_gcm', 'aes_256_gcm', 'chacha20', 'aes-gcm'].some((good) => c.includes(good));
}

export function deriveSeverity(asset = {}) {
  const explicit = normalize(asset.severity || asset.riskSeverity || asset.metadata?.severity);
  if (['critical', 'high', 'moderate', 'low'].includes(explicit)) return explicit;

  let score = 0;

  const tlsVersion = asset.tlsVersion || asset.protocol || asset.metadata?.tlsVersion;
  const cipher = asset.cipherSuite || asset.cipher || asset.metadata?.cipher;
  const keyLength = parseKeyLength(asset.keyLength || asset.metadata?.keyLength);
  const validTo = parseDate(asset.validTo || asset.expiresAt || asset.metadata?.validTo);

  if (isWeakProtocol(tlsVersion)) score += 45;
  if (isWeakCipher(cipher)) score += 30;

  if (keyLength > 0 && keyLength < 1024) score += 45;
  else if (keyLength > 0 && keyLength < 2048) score += 25;

  if (validTo) {
    const daysLeft = Math.ceil((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) score += 40;
    else if (daysLeft <= 15) score += 28;
    else if (daysLeft <= 30) score += 15;
  }

  if (score >= 70) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 20) return 'moderate';
  return 'low';
}

export function derivePqc(asset = {}) {
  const explicitGrade = normalize(asset?.pqc?.grade || asset.pqcGrade);
  const explicitSupport = normalize(asset?.pqc?.supportStatus || asset.pqcSupport);

  if (
    ['elite', 'standard', 'legacy', 'critical'].includes(explicitGrade) &&
    ['ready', 'partial', 'legacy', 'critical', 'standard'].includes(explicitSupport || 'ready')
  ) {
    return {
      grade: explicitGrade,
      supportStatus:
        explicitSupport ||
        (explicitGrade === 'elite'
          ? 'ready'
          : explicitGrade === 'standard'
          ? 'partial'
          : explicitGrade),
    };
  }

  const assetType = inferAssetType(asset);
  const explicitTls = normalize(
    asset.tlsVersion ||
      asset.protocol ||
      asset.metadata?.tlsVersion ||
      asset.metadata?.tls_version ||
      asset.metadata?.protocol
  );
  const tlsVersion = explicitTls || (assetType === 'domain' || assetType === 'api' ? 'tlsv1.0' : '');
  const tlsVersionAssumed = Boolean(
    asset.tlsVersionAssumed || asset.metadata?.tlsVersionAssumed || (!explicitTls && (assetType === 'domain' || assetType === 'api'))
  );
  const cipher = normalize(asset.cipherSuite || asset.cipher || asset.metadata?.cipher);
  const keyLength = parseKeyLength(
    asset.keyLength ||
      asset.key_length ||
      asset.keySize ||
      asset.key_size ||
      asset.publicKeyLength ||
      asset.public_key_length ||
      asset.publicKeyBits ||
      asset.public_key_bits ||
      asset.bits ||
      asset.metadata?.keyLength ||
      asset.metadata?.key_length ||
      asset.metadata?.keySize ||
      asset.metadata?.key_size ||
      asset.metadata?.publicKeyLength ||
      asset.metadata?.public_key_length ||
      asset.metadata?.publicKeyBits ||
      asset.metadata?.public_key_bits ||
      asset.metadata?.bits ||
      asset.metadata?.tls?.keyLength ||
      asset.metadata?.tls?.key_length ||
      asset.metadata?.tls?.bits
  );

  if (
    tlsVersion.includes('ssl') ||
    (tlsVersion.includes('1.0') && !tlsVersionAssumed) ||
    (keyLength > 0 && keyLength < 1024)
  ) {
    return { grade: 'critical', supportStatus: 'critical' };
  }

  if (tlsVersion.includes('1.1') || tlsVersionAssumed || isWeakCipher(cipher) || (keyLength > 0 && keyLength < 2048)) {
    return { grade: 'legacy', supportStatus: 'legacy' };
  }

  if (tlsVersion.includes('1.3') && isModernCipher(cipher) && keyLength >= 3072) {
    return { grade: 'elite', supportStatus: 'ready' };
  }

  return { grade: 'standard', supportStatus: 'partial' };
}

export function computeAssetScore(asset = {}) {
  let score = 100;

  const tlsVersion = asset.tlsVersion || asset.protocol || asset.metadata?.tlsVersion;
  const cipher = asset.cipherSuite || asset.cipher || asset.metadata?.cipher;
  const keyLength = parseKeyLength(asset.keyLength || asset.metadata?.keyLength);
  const validTo = parseDate(asset.validTo || asset.expiresAt || asset.metadata?.validTo);

  if (isWeakProtocol(tlsVersion)) score -= 30;
  if (isWeakCipher(cipher)) score -= 22;
  if (keyLength > 0 && keyLength < 1024) score -= 30;
  else if (keyLength > 0 && keyLength < 2048) score -= 15;

  if (validTo) {
    const daysLeft = Math.ceil((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) score -= 25;
    else if (daysLeft <= 15) score -= 18;
    else if (daysLeft <= 30) score -= 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreToEnterpriseLabel(score) {
  if (score > 700) return 'Elite-PQC';
  if (score >= 400) return 'Standard';
  return 'Legacy';
}

export function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}