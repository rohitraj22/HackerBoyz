import dns from 'node:dns/promises';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { Asset } from '../../models/Asset.js';
import { Scan } from '../../models/Scan.js';
import AssetRelation from '../../models/AssetRelation.js';

function now() {
  return new Date();
}

function safeString(value) {
  return String(value || '').trim();
}

function normalizeDomain(target) {
  return safeString(target)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function normalizeApiUrl(target) {
  const raw = safeString(target);
  if (!raw) throw new Error('API target is required');

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);

  return {
    url: url.toString(),
    origin: url.origin,
    hostname: url.hostname.toLowerCase(),
  };
}

function buildTargetInfo(targetType, target) {
  if (targetType === 'domain') {
    const domain = normalizeDomain(target);
    return {
      targetType,
      normalizedTarget: domain,
    };
  }

  if (targetType === 'api') {
    const api = normalizeApiUrl(target);
    return {
      targetType,
      normalizedTarget: api.origin,
      ...api,
    };
  }

  throw new Error('Unsupported targetType. Use domain or api');
}

function getTlsInfo(hostname, port = 443) {
  // Function to get TLS information
  return new Promise((resolve) => {
    let finished = false;

    const done = (payload) => {
      if (finished) return;
      finished = true;
      resolve(payload);
    };

    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: false,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true) || {};
          const cipher = socket.getCipher() || {};
          const ephemeral = typeof socket.getEphemeralKeyInfo === 'function' ? socket.getEphemeralKeyInfo() || {} : {};

          let publicKeyAlgorithm = '';
          let publicKeyBits = 0;
          let signatureAlgorithm = '';

          if (cert?.raw) {
            try {
              const x509 = new crypto.X509Certificate(cert.raw);
              publicKeyAlgorithm = safeString(x509.publicKey?.asymmetricKeyType || '');
              signatureAlgorithm = safeString(x509.signatureAlgorithm || '');

              const details = x509.publicKey?.asymmetricKeyDetails || {};
              if (Number.isFinite(details.modulusLength)) {
                publicKeyBits = Number(details.modulusLength);
              } else if (safeString(details.namedCurve)) {
                const curve = safeString(details.namedCurve).toLowerCase();
                if (curve.includes('521')) publicKeyBits = 521;
                else if (curve.includes('384')) publicKeyBits = 384;
                else if (curve.includes('256')) publicKeyBits = 256;
              }
            } catch {
              // Keep probe resilient; fallback to basic TLS metadata if X509 parsing fails.
            }
          }

          if (!publicKeyAlgorithm) {
            publicKeyAlgorithm = safeString(cert.pubkeyAlgorithm || cert.publicKeyAlgorithm || cert.asymmetricKeyType || '');
          }

          if (!publicKeyBits) {
            const certBits = Number(cert.bits || cert.publicKeyBits || cert.modulusLength || cert.keyLength || 0);
            if (Number.isFinite(certBits) && certBits > 0) {
              publicKeyBits = certBits;
            }
          }

          if (!signatureAlgorithm) {
            signatureAlgorithm = safeString(cert.signatureAlgorithm || cert.sigalg || cert.signature || '');
          }

          const keyExchange = safeString(ephemeral.type || ephemeral.name || '');
          const keyExchangeBits = Number(ephemeral.size || 0);
          const cipherBits = Number(cipher.bits || 0);
          const resolvedKeyLength = publicKeyBits || keyExchangeBits || cipherBits || 0;

          done({
            tlsVersion: socket.getProtocol() || '',
            cipherSuite: cipher.name || '',
            cipherStandardName: cipher.standardName || '',
            certificateAuthority:
              cert.issuer?.O ||
              cert.issuer?.CN ||
              cert.issuerOrganization ||
              '',
            commonName: cert.subject?.CN || '',
            validFrom: cert.valid_from ? new Date(cert.valid_from) : null,
            validTo: cert.valid_to ? new Date(cert.valid_to) : null,
            fingerprint: cert.fingerprint256 || cert.fingerprint || '',
            keyLength: resolvedKeyLength ? String(resolvedKeyLength) : '',
            publicKeyAlgorithm,
            publicKeyBits: publicKeyBits ? String(publicKeyBits) : '',
            signatureAlgorithm,
            keyExchange,
            keyExchangeBits: keyExchangeBits ? String(keyExchangeBits) : '',
            cipherBits: cipherBits ? String(cipherBits) : '',
          });

          socket.end();
        } catch {
          done({});
          socket.destroy();
        }
      }
    );

    socket.setTimeout(8000, () => {
      done({});
      socket.destroy();
    });

    socket.on('error', () => {
      done({});
    });
  });
}

function applyTlsInfo(asset = {}, tlsInfo = {}) {
  return {
    ...asset,
    tlsVersion: tlsInfo.tlsVersion || asset.tlsVersion || '',
    cipherSuite: tlsInfo.cipherSuite || asset.cipherSuite || '',
    keyLength: tlsInfo.keyLength || asset.keyLength || '',
    keyExchange: tlsInfo.keyExchange || asset.keyExchange || '',
    signature: tlsInfo.signatureAlgorithm || asset.signature || '',
    metadata: {
      ...(asset.metadata || {}),
      tlsVersion: tlsInfo.tlsVersion || asset.metadata?.tlsVersion || '',
      tls_version: tlsInfo.tlsVersion || asset.metadata?.tls_version || '',
      cipherSuite: tlsInfo.cipherSuite || asset.metadata?.cipherSuite || '',
      cipherStandardName: tlsInfo.cipherStandardName || asset.metadata?.cipherStandardName || '',
      keyLength: tlsInfo.keyLength || asset.metadata?.keyLength || '',
      key_length: tlsInfo.keyLength || asset.metadata?.key_length || '',
      publicKeyAlgorithm: tlsInfo.publicKeyAlgorithm || asset.metadata?.publicKeyAlgorithm || '',
      publicKeyBits: tlsInfo.publicKeyBits || asset.metadata?.publicKeyBits || '',
      signatureAlgorithm: tlsInfo.signatureAlgorithm || asset.metadata?.signatureAlgorithm || '',
      keyExchange: tlsInfo.keyExchange || asset.metadata?.keyExchange || '',
      keyExchangeBits: tlsInfo.keyExchangeBits || asset.metadata?.keyExchangeBits || '',
      cipherBits: tlsInfo.cipherBits || asset.metadata?.cipherBits || '',
      fingerprint: tlsInfo.fingerprint || asset.metadata?.fingerprint || '',
    },
  };
}

async function probeHttp(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Quantum-Scanner/1.0',
      },
    });

    return {
      reachable: true,
      finalUrl: res.url,
      statusCode: res.status,
      contentType: res.headers.get('content-type') || '',
      server: res.headers.get('server') || '',
    };
  } catch {
    return {
      reachable: false,
      finalUrl: url,
      statusCode: null,
      contentType: '',
      server: '',
    };
  }
}

async function discoverDomain(domain) {
  const discoveredAssets = [];
  const discoveredRelations = [];

  discoveredAssets.push({
    tempKey: `domain:${domain}`,
    assetType: 'domain',
    name: domain,
    hostname: domain,
    domain,
    source: 'manual_discovery',
    status: 'new',
    metadata: {},
  });

  let ipv4 = [];
  let ipv6 = [];

  try {
    ipv4 = await dns.resolve4(domain);
  } catch {}

  try {
    ipv6 = await dns.resolve6(domain);
  } catch {}

  const allIps = [...ipv4, ...ipv6];

  for (const ip of allIps) {
    discoveredAssets.push({
      tempKey: `ip:${ip}`,
      assetType: 'ip',
      name: ip,
      ipAddress: ip,
      source: 'dns_resolution',
      status: 'new',
      metadata: {},
    });

    discoveredRelations.push({
      sourceTempKey: `domain:${domain}`,
      targetTempKey: `ip:${ip}`,
      relationType: 'resolves_to',
      confidence: 0.95,
    });
  }

  const httpsProbe = await probeHttp(`https://${domain}`);
  const httpProbe = httpsProbe.reachable ? null : await probeHttp(`http://${domain}`);
  const bestProbe = httpsProbe.reachable ? httpsProbe : httpProbe;

  if (bestProbe?.reachable) {
    discoveredAssets.push({
      tempKey: `webapp:${domain}`,
      assetType: 'webapp',
      name: bestProbe.finalUrl || domain,
      url: bestProbe.finalUrl || `https://${domain}`,
      hostname: domain,
      domain,
      source: 'http_probe',
      status: 'new',
      metadata: {
        statusCode: bestProbe.statusCode,
        contentType: bestProbe.contentType,
        server: bestProbe.server,
      },
    });

    discoveredRelations.push({
      sourceTempKey: `domain:${domain}`,
      targetTempKey: `webapp:${domain}`,
      relationType: 'hosts_service',
      confidence: 0.9,
    });
  }

  const tlsInfo = await getTlsInfo(domain, 443);

  if (tlsInfo.tlsVersion || tlsInfo.keyLength || tlsInfo.publicKeyAlgorithm || tlsInfo.signatureAlgorithm) {
    const domainIndex = discoveredAssets.findIndex((asset) => asset.tempKey === `domain:${domain}`);
    if (domainIndex >= 0) {
      discoveredAssets[domainIndex] = applyTlsInfo(discoveredAssets[domainIndex], tlsInfo);
    }

    const webappIndex = discoveredAssets.findIndex((asset) => asset.tempKey === `webapp:${domain}`);
    if (webappIndex >= 0) {
      discoveredAssets[webappIndex] = applyTlsInfo(discoveredAssets[webappIndex], tlsInfo);
    }
  }

  if (tlsInfo.commonName || tlsInfo.certificateAuthority || tlsInfo.tlsVersion) {
    const certTempKey = tlsInfo.fingerprint
      ? `cert:${tlsInfo.fingerprint}`
      : `cert:${domain}`;

    discoveredAssets.push({
      tempKey: certTempKey,
      assetType: 'certificate',
      name: tlsInfo.commonName || domain,
      hostname: domain,
      domain,
      commonName: tlsInfo.commonName,
      certificateAuthority: tlsInfo.certificateAuthority,
      tlsVersion: tlsInfo.tlsVersion,
      cipherSuite: tlsInfo.cipherSuite,
      validFrom: tlsInfo.validFrom,
      validTo: tlsInfo.validTo,
      keyLength: tlsInfo.keyLength,
      signature: tlsInfo.signatureAlgorithm,
      keyExchange: tlsInfo.keyExchange,
      source: 'tls_probe',
      status: 'new',
      metadata: {
        fingerprint: tlsInfo.fingerprint,
        publicKeyAlgorithm: tlsInfo.publicKeyAlgorithm,
        publicKeyBits: tlsInfo.publicKeyBits,
        signatureAlgorithm: tlsInfo.signatureAlgorithm,
        keyExchange: tlsInfo.keyExchange,
        keyExchangeBits: tlsInfo.keyExchangeBits,
        cipherBits: tlsInfo.cipherBits,
        cipherStandardName: tlsInfo.cipherStandardName,
      },
    });

    discoveredRelations.push({
      sourceTempKey: `domain:${domain}`,
      targetTempKey: certTempKey,
      relationType: 'uses_cert',
      confidence: 0.95,
    });
  }

  return { discoveredAssets, discoveredRelations };
}

async function discoverApi(target) {
  const api = normalizeApiUrl(target);
  const discoveredAssets = [];
  const discoveredRelations = [];

  const probe = await probeHttp(api.origin);
  const tlsInfo = await getTlsInfo(api.hostname, 443);

  discoveredAssets.push({
    tempKey: `api:${api.origin.toLowerCase()}`,
    assetType: 'api',
    name: api.origin,
    url: api.origin,
    hostname: api.hostname,
    domain: api.hostname,
    source: 'manual_discovery',
    status: 'new',
    isApi: true,
    tlsVersion: tlsInfo.tlsVersion || '',
    cipherSuite: tlsInfo.cipherSuite || '',
    keyLength: tlsInfo.keyLength || '',
    keyExchange: tlsInfo.keyExchange || '',
    signature: tlsInfo.signatureAlgorithm || '',
    metadata: {
      statusCode: probe.statusCode,
      reachable: probe.reachable,
      contentType: probe.contentType,
      server: probe.server,
      tlsVersion: tlsInfo.tlsVersion || '',
      tls_version: tlsInfo.tlsVersion || '',
      cipherSuite: tlsInfo.cipherSuite || '',
      cipherStandardName: tlsInfo.cipherStandardName || '',
      keyLength: tlsInfo.keyLength || '',
      key_length: tlsInfo.keyLength || '',
      publicKeyAlgorithm: tlsInfo.publicKeyAlgorithm || '',
      publicKeyBits: tlsInfo.publicKeyBits || '',
      signatureAlgorithm: tlsInfo.signatureAlgorithm || '',
      keyExchange: tlsInfo.keyExchange || '',
      keyExchangeBits: tlsInfo.keyExchangeBits || '',
      cipherBits: tlsInfo.cipherBits || '',
      fingerprint: tlsInfo.fingerprint || '',
    },
  });

  discoveredAssets.push({
    tempKey: `domain:${api.hostname}`,
    assetType: 'domain',
    name: api.hostname,
    hostname: api.hostname,
    domain: api.hostname,
    source: 'derived_from_api',
    status: 'new',
    tlsVersion: tlsInfo.tlsVersion || '',
    cipherSuite: tlsInfo.cipherSuite || '',
    keyLength: tlsInfo.keyLength || '',
    keyExchange: tlsInfo.keyExchange || '',
    signature: tlsInfo.signatureAlgorithm || '',
    metadata: {
      tlsVersion: tlsInfo.tlsVersion || '',
      tls_version: tlsInfo.tlsVersion || '',
      cipherSuite: tlsInfo.cipherSuite || '',
      cipherStandardName: tlsInfo.cipherStandardName || '',
      keyLength: tlsInfo.keyLength || '',
      key_length: tlsInfo.keyLength || '',
      publicKeyAlgorithm: tlsInfo.publicKeyAlgorithm || '',
      publicKeyBits: tlsInfo.publicKeyBits || '',
      signatureAlgorithm: tlsInfo.signatureAlgorithm || '',
      keyExchange: tlsInfo.keyExchange || '',
      keyExchangeBits: tlsInfo.keyExchangeBits || '',
      cipherBits: tlsInfo.cipherBits || '',
      fingerprint: tlsInfo.fingerprint || '',
    },
  });

  discoveredRelations.push({
    sourceTempKey: `domain:${api.hostname}`,
    targetTempKey: `api:${api.origin.toLowerCase()}`,
    relationType: 'hosts_service',
    confidence: 0.95,
  });

  if (tlsInfo.commonName || tlsInfo.certificateAuthority || tlsInfo.tlsVersion) {
    const certTempKey = tlsInfo.fingerprint
      ? `cert:${tlsInfo.fingerprint}`
      : `cert:${api.hostname}`;

    discoveredAssets.push({
      tempKey: certTempKey,
      assetType: 'certificate',
      name: tlsInfo.commonName || api.hostname,
      hostname: api.hostname,
      domain: api.hostname,
      commonName: tlsInfo.commonName,
      certificateAuthority: tlsInfo.certificateAuthority,
      tlsVersion: tlsInfo.tlsVersion,
      cipherSuite: tlsInfo.cipherSuite,
      validFrom: tlsInfo.validFrom,
      validTo: tlsInfo.validTo,
      keyLength: tlsInfo.keyLength,
      signature: tlsInfo.signatureAlgorithm,
      keyExchange: tlsInfo.keyExchange,
      source: 'tls_probe',
      status: 'new',
      metadata: {
        fingerprint: tlsInfo.fingerprint,
        publicKeyAlgorithm: tlsInfo.publicKeyAlgorithm,
        publicKeyBits: tlsInfo.publicKeyBits,
        signatureAlgorithm: tlsInfo.signatureAlgorithm,
        keyExchange: tlsInfo.keyExchange,
        keyExchangeBits: tlsInfo.keyExchangeBits,
        cipherBits: tlsInfo.cipherBits,
        cipherStandardName: tlsInfo.cipherStandardName,
      },
    });

    discoveredRelations.push({
      sourceTempKey: `api:${api.origin.toLowerCase()}`,
      targetTempKey: certTempKey,
      relationType: 'uses_cert',
      confidence: 0.95,
    });
  }

  return { discoveredAssets, discoveredRelations };
}

async function saveDiscoveryResults({ discoveredAssets, discoveredRelations, scanId }) {
  const savedAssets = [];
  const assetIdByTempKey = new Map();

  for (const asset of discoveredAssets) {
    const { tempKey, ...assetData } = asset;

    const created = await Asset.create({
      ...assetData,
      scanId,
      target: assetData.target || assetData.domain || assetData.url || assetData.name || '',
      metadata: assetData.metadata || {},
    });

    savedAssets.push(created);
    assetIdByTempKey.set(tempKey, created._id);
  }

  const savedRelations = [];

  for (const rel of discoveredRelations) {
    const sourceAssetId = assetIdByTempKey.get(rel.sourceTempKey);
    const targetAssetId = assetIdByTempKey.get(rel.targetTempKey);

    if (!sourceAssetId || !targetAssetId) continue;

    const createdRelation = await AssetRelation.create({
      scanId,
      sourceAssetId,
      targetAssetId,
      relationType: rel.relationType,
      confidence: rel.confidence ?? 0.8,
      metadata: {},
    });

    savedRelations.push(createdRelation);
  }

  return { savedAssets, savedRelations };
}

export async function runDiscoveryForTarget({ targetType, target, userId }) {
  const targetInfo = buildTargetInfo(targetType, target);

  const scan = await Scan.create({
    userId: userId || null,
    name: `Discovery: ${targetInfo.normalizedTarget}`,
    target: targetInfo.normalizedTarget,
    status: 'running',
    metadata: {
      source: 'manual_discovery',
      targetType,
    },
  });

  try {
    let discoveryResult = { discoveredAssets: [], discoveredRelations: [] };

    if (targetType === 'domain') {
      discoveryResult = await discoverDomain(target);
    } else if (targetType === 'api') {
      discoveryResult = await discoverApi(target);
    }

    const { savedAssets, savedRelations } = await saveDiscoveryResults({
      discoveredAssets: discoveryResult.discoveredAssets,
      discoveredRelations: discoveryResult.discoveredRelations,
      scanId: scan._id,
    });

    scan.status = 'completed';
    scan.metadata = {
      ...(scan.metadata || {}),
      discoveredCount: savedAssets.length,
      relationCount: savedRelations.length,
    };
    await scan.save();

    return {
      message: 'Discovery completed successfully',
      scan,
      discoveredAssets: savedAssets,
      discoveredRelations: savedRelations,
    };
  } catch (error) {
    scan.status = 'failed';
    scan.metadata = {
      ...(scan.metadata || {}),
      error: error.message,
    };
    await scan.save();

    throw error;
  }
}