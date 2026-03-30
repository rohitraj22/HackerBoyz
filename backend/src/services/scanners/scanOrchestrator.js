import { logger } from '../../utils/logger.js';
import dns from 'node:dns/promises';
import { runTLSScanner } from './tlsScanner.js';
import { runAPIScanner } from './apiScanner.js';
import { parseTLSOutput } from '../parsers/tlsParser.js';
import { parseDependencyOutput } from '../parsers/dependencyParser.js';
import { parseCryptoOutput } from '../parsers/cryptoParser.js';
import { calculateRisk } from '../risk/riskEngine.js';
import { generateCBOM } from '../cbom/cbomGenerator.js';
import { generateRecommendations } from '../ai/geminiService.js';
import { runCommand } from '../../utils/runCommand.js';

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function extractValue(text, patterns = []) {
  const source = String(text || '');
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function parseDateValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function normalizeDomain(value = '') {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function parseApiEndpoint(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    return {
      url: url.toString(),
      origin: url.origin,
      hostname: url.hostname.toLowerCase(),
      port: String(url.port || (url.protocol === 'http:' ? 80 : 443)),
      path: url.pathname || '/',
      protocol: url.protocol,
    };
  } catch {
    return null;
  }
}

async function runWhoisQuery(target) {
  if (!target) return '';

  try {
    const result = await runCommand('whois', [target], { allowNonZeroExit: true });
    return String(result?.stdout || result?.stderr || '').trim();
  } catch {
    return '';
  }
}

function parseDomainWhois(raw = '') {
  const registrar = extractValue(raw, [
    /^Registrar\s*:\s*(.+)$/im,
    /^Sponsoring Registrar\s*:\s*(.+)$/im,
    /^Registrar Name\s*:\s*(.+)$/im,
    /^Registrar Organization\s*:\s*(.+)$/im,
  ]);

  const registrationDateRaw = extractValue(raw, [
    /^Creation Date\s*:\s*(.+)$/im,
    /^Registered On\s*:\s*(.+)$/im,
    /^Domain Registration Date\s*:\s*(.+)$/im,
    /^Created(?:\s*On|\s*Date)?\s*:\s*(.+)$/im,
  ]);

  const companyName = extractValue(raw, [
    /^Registrant Organization\s*:\s*(.+)$/im,
    /^Registrant Org(?:anization)?\s*:\s*(.+)$/im,
    /^Organization\s*:\s*(.+)$/im,
    /^OrgName\s*:\s*(.+)$/im,
  ]);

  return {
    registrar,
    registrationDate: parseDateValue(registrationDateRaw),
    companyName,
    registrationDateRaw,
  };
}

function parseIpWhois(raw = '') {
  const netname = extractValue(raw, [
    /^netname\s*:\s*(.+)$/im,
    /^NetName\s*:\s*(.+)$/im,
    /^OrgName\s*:\s*(.+)$/im,
    /^owner\s*:\s*(.+)$/im,
  ]);

  const asn = extractValue(raw, [
    /^origin(?:as)?\s*:\s*(AS\d+)$/im,
    /^aut-num\s*:\s*(AS\d+)$/im,
    /^OriginAS\s*:\s*(AS\d+)$/im,
  ]);

  const city = extractValue(raw, [/^city\s*:\s*(.+)$/im]);
  const country = extractValue(raw, [/^country\s*:\s*(.+)$/im]);
  const location = firstNonEmpty(
    [city, country].filter(Boolean).join(', '),
    country,
    city
  );

  const companyName = extractValue(raw, [
    /^OrgName\s*:\s*(.+)$/im,
    /^org-name\s*:\s*(.+)$/im,
    /^descr\s*:\s*(.+)$/im,
  ]);

  const subnet = extractValue(raw, [
    /^route\s*:\s*(.+)$/im,
    /^route6\s*:\s*(.+)$/im,
    /^CIDR\s*:\s*(.+)$/im,
    /^inetnum\s*:\s*(.+)$/im,
  ]);

  return {
    netname,
    asn,
    location,
    companyName,
    subnet,
    city,
    country,
  };
}

async function collectHostIntel(hostname) {
  const cleanHost = normalizeDomain(hostname);
  if (!cleanHost) {
    return {
      hostname: '',
      ipAddress: '',
      registrar: '',
      registrationDate: null,
      companyName: '',
      location: '',
      netname: '',
      asn: '',
      subnet: '',
      whoisDomainRaw: '',
      whoisIpRaw: '',
    };
  }

  let ipAddress = '';
  try {
    const lookup = await dns.lookup(cleanHost);
    ipAddress = lookup?.address || '';
  } catch {
    ipAddress = '';
  }

  const [domainWhoisRaw, ipWhoisRaw] = await Promise.all([
    runWhoisQuery(cleanHost),
    ipAddress ? runWhoisQuery(ipAddress) : Promise.resolve(''),
  ]);

  const domainWhois = parseDomainWhois(domainWhoisRaw);
  const ipWhois = parseIpWhois(ipWhoisRaw);

  return {
    hostname: cleanHost,
    ipAddress,
    registrar: domainWhois.registrar,
    registrationDate: domainWhois.registrationDate,
    companyName: firstNonEmpty(domainWhois.companyName, ipWhois.companyName),
    location: ipWhois.location,
    netname: ipWhois.netname,
    asn: ipWhois.asn,
    subnet: ipWhois.subnet,
    whoisDomainRaw: domainWhoisRaw,
    whoisIpRaw: ipWhoisRaw,
    registrationDateRaw: domainWhois.registrationDateRaw,
    city: ipWhois.city,
    country: ipWhois.country,
  };
}

function dedupeAssets(assets = []) {
  const seen = new Set();
  const deduped = [];

  for (const asset of assets) {
    const key = [
      asset.assetType || 'unknown',
      asset.domain || '',
      asset.hostname || '',
      asset.ipAddress || '',
      asset.apiPath || '',
      asset.name || '',
      asset.target || '',
      asset.commonName || '',
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(asset);
  }

  return deduped;
}

async function buildEnrichedAssets({ inputs, cbom, tls, api }) {
  const assets = [];

  if (inputs.domain) {
    const hostIntel = await collectHostIntel(inputs.domain);
    const domain = normalizeDomain(inputs.domain);

    assets.push({
      assetType: 'domain',
      target: domain,
      name: domain,
      domain,
      hostname: domain,
      owner: hostIntel.companyName,
      registrar: hostIntel.registrar,
      registrationDate: hostIntel.registrationDate,
      commonName: tls.commonName || '',
      certificateAuthority: tls.issuer || '',
      tlsVersion: tls.tlsVersion || '',
      cipher: tls.cipher || '',
      keyExchange: tls.keyExchange || '',
      signature: tls.signature || '',
      issuer: tls.issuer || '',
      findings: tls.findings || [],
      quantumSafe: null,
      metadata: {
        ...cbom.assets.find((item) => item.asset_type === 'domain'),
        fingerprint: tls.fingerprint || '',
        ipAddress: hostIntel.ipAddress,
        netname: hostIntel.netname,
        location: hostIntel.location,
        asn: hostIntel.asn,
        subnet: hostIntel.subnet,
        companyName: hostIntel.companyName,
        registrar: hostIntel.registrar,
        registrationDate: firstNonEmpty(hostIntel.registrationDateRaw, hostIntel.registrationDate),
        city: hostIntel.city,
        country: hostIntel.country,
      },
    });

    if (hostIntel.ipAddress) {
      assets.push({
        assetType: 'ip',
        target: domain,
        name: hostIntel.ipAddress,
        hostname: domain,
        domain,
        ipAddress: hostIntel.ipAddress,
        subnet: hostIntel.subnet,
        port: '443',
        owner: hostIntel.companyName,
        metadata: {
          netname: hostIntel.netname,
          location: hostIntel.location,
          asn: hostIntel.asn,
          companyName: hostIntel.companyName,
          city: hostIntel.city,
          country: hostIntel.country,
        },
      });
    }

    if (tls.commonName || tls.issuer || tls.fingerprint) {
      assets.push({
        assetType: 'certificate',
        target: domain,
        name: tls.commonName || domain,
        hostname: domain,
        domain,
        commonName: tls.commonName || '',
        certificateAuthority: tls.issuer || '',
        tlsVersion: tls.tlsVersion || '',
        cipher: tls.cipher || '',
        keyExchange: tls.keyExchange || '',
        signature: tls.signature || '',
        issuer: tls.issuer || '',
        port: '443',
        owner: hostIntel.companyName,
        metadata: {
          fingerprint: tls.fingerprint || '',
          ipAddress: hostIntel.ipAddress,
        },
      });
    }
  }

  if (inputs.apiEndpoint) {
    const apiTarget = parseApiEndpoint(inputs.apiEndpoint);

    if (apiTarget) {
      const hostIntel = await collectHostIntel(apiTarget.hostname);
      const companyName = firstNonEmpty(hostIntel.companyName, api.companyName);

      assets.push({
        assetType: 'api',
        target: apiTarget.origin,
        name: apiTarget.origin,
        url: apiTarget.origin,
        apiPath: apiTarget.path,
        hostname: apiTarget.hostname,
        domain: apiTarget.hostname,
        port: firstNonEmpty(api.port, apiTarget.port),
        ipAddress: firstNonEmpty(api.ipAddress, hostIntel.ipAddress),
        owner: companyName,
        isApi: true,
        commonName: firstNonEmpty(api.commonName, tls.commonName),
        certificateAuthority: firstNonEmpty(api.certificateAuthority, api.issuer),
        tlsVersion: firstNonEmpty(api.tlsVersion, tls.tlsVersion),
        cipher: firstNonEmpty(api.cipher, tls.cipher),
        keyExchange: firstNonEmpty(api.keyExchange, tls.keyExchange),
        signature: firstNonEmpty(api.signature, tls.signature),
        issuer: firstNonEmpty(api.issuer, tls.issuer),
        softwareName: api.softwareName || '',
        softwareVersion: api.softwareVersion || '',
        metadata: {
          ...cbom.assets.find((item) => item.asset_type === 'api'),
          fingerprint: firstNonEmpty(api.fingerprint, tls.fingerprint),
          registrar: hostIntel.registrar,
          registrationDate: firstNonEmpty(hostIntel.registrationDateRaw, hostIntel.registrationDate),
          netname: hostIntel.netname,
          location: hostIntel.location,
          asn: hostIntel.asn,
          subnet: hostIntel.subnet,
          companyName,
          server: api.serverHeader || '',
          contentType: api.contentType || '',
          softwareType: api.softwareType || '',
          statusCode: api.statusCode || 0,
          city: hostIntel.city,
          country: hostIntel.country,
        },
      });

      assets.push({
        assetType: 'domain',
        target: apiTarget.origin,
        name: apiTarget.hostname,
        hostname: apiTarget.hostname,
        domain: apiTarget.hostname,
        owner: companyName,
        registrar: hostIntel.registrar,
        registrationDate: hostIntel.registrationDate,
        metadata: {
          companyName,
          registrar: hostIntel.registrar,
          registrationDate: firstNonEmpty(hostIntel.registrationDateRaw, hostIntel.registrationDate),
          netname: hostIntel.netname,
          location: hostIntel.location,
          asn: hostIntel.asn,
          subnet: hostIntel.subnet,
        },
      });

      if (firstNonEmpty(api.ipAddress, hostIntel.ipAddress)) {
        assets.push({
          assetType: 'ip',
          target: apiTarget.origin,
          name: firstNonEmpty(api.ipAddress, hostIntel.ipAddress),
          hostname: apiTarget.hostname,
          domain: apiTarget.hostname,
          ipAddress: firstNonEmpty(api.ipAddress, hostIntel.ipAddress),
          port: firstNonEmpty(api.port, apiTarget.port),
          subnet: hostIntel.subnet,
          owner: companyName,
          metadata: {
            netname: hostIntel.netname,
            location: hostIntel.location,
            asn: hostIntel.asn,
            companyName,
            city: hostIntel.city,
            country: hostIntel.country,
          },
        });
      }

      if (api.softwareName || api.softwareVersion) {
        assets.push({
          assetType: 'software',
          target: apiTarget.origin,
          name: api.softwareName || apiTarget.hostname,
          softwareName: api.softwareName || '',
          softwareVersion: api.softwareVersion || '',
          product: api.softwareName || '',
          hostname: apiTarget.hostname,
          domain: apiTarget.hostname,
          port: firstNonEmpty(api.port, apiTarget.port),
          owner: companyName,
          metadata: {
            softwareType: api.softwareType || '',
            server: api.serverHeader || '',
            poweredBy: api.poweredBy || '',
            contentType: api.contentType || '',
          },
        });
      }

      if (api.commonName || api.certificateAuthority || api.fingerprint) {
        assets.push({
          assetType: 'certificate',
          target: apiTarget.origin,
          name: api.commonName || apiTarget.hostname,
          hostname: apiTarget.hostname,
          domain: apiTarget.hostname,
          commonName: api.commonName || '',
          certificateAuthority: firstNonEmpty(api.certificateAuthority, api.issuer),
          tlsVersion: firstNonEmpty(api.tlsVersion, tls.tlsVersion),
          cipher: firstNonEmpty(api.cipher, tls.cipher),
          keyExchange: firstNonEmpty(api.keyExchange, tls.keyExchange),
          signature: firstNonEmpty(api.signature, tls.signature),
          issuer: firstNonEmpty(api.issuer, tls.issuer),
          port: firstNonEmpty(api.port, apiTarget.port),
          owner: companyName,
          metadata: {
            fingerprint: firstNonEmpty(api.fingerprint, tls.fingerprint),
            ipAddress: firstNonEmpty(api.ipAddress, hostIntel.ipAddress),
          },
        });
      }
    }
  }

  return dedupeAssets(assets);
}

export async function runFullScan(inputs) {
  const warnings = [];

  const safeScanStep = async (name, fn) => {
    try {
      return await fn();
    } catch (error) {
      logger.warn(`${name} failed`, {
        message: error?.message,
        stderr: error?.stderr,
      });

      return {
        raw: '',
        skipped: true,
        reason:
          `${name} failed: ${error?.message || 'unexpected scanner error'}. ` +
          'Check scanner binary path/permissions and retry.',
      };
    }
  };

  const [tlsRaw, apiRaw] = await Promise.all([
    safeScanStep('TLS scan', () => runTLSScanner(inputs.domain)),
    safeScanStep('API scan', () => runAPIScanner(inputs.apiEndpoint))
  ]);

  const dependencyRaw = { raw: '', skipped: true, reason: 'Repository scanning is disabled.' };
  const cryptoRaw = { raw: '', skipped: true, reason: 'Repository scanning is disabled.' };
  const tls = parseTLSOutput(tlsRaw.raw);
  const dependency = parseDependencyOutput(dependencyRaw.raw);
  const cryptoFindings = parseCryptoOutput(cryptoRaw.raw);
  const api = apiRaw || {};

  if (inputs.domain && tlsRaw.skipped) warnings.push(tlsRaw.reason);
  if (inputs.apiEndpoint && apiRaw?.skipped) warnings.push(apiRaw.reason);

  const risk = calculateRisk({
    tls,
    dependency,
    crypto: cryptoFindings,
    api,
    apiTargetProvided: Boolean(inputs.apiEndpoint),
  });

  const cbom = generateCBOM({
    inputs,
    tls,
    dependency,
    crypto: cryptoFindings,
    api,
    risk
  });

  const recommendation = await generateRecommendations({
    inputs,
    risk,
    cbom
  });

  const enrichedAssets = await buildEnrichedAssets({ inputs, cbom, tls, api });

  const fallbackAssets = cbom.assets.map((asset) => ({
    assetType: asset.asset_type || 'unknown',
    target: asset.target || '',
    tlsVersion: asset.tls_version || '',
    cipher: asset.cipher || '',
    keyExchange: asset.key_exchange || '',
    signature: asset.signature || '',
    issuer: asset.issuer || '',
    quantumSafe:
      asset.quantum_safe === true
        ? true
        : asset.quantum_safe === false
        ? false
        : null,
    findings: asset.findings || [],
    metadata: asset,
  }));

  const assets = dedupeAssets([...enrichedAssets, ...fallbackAssets]);

  return {
    summary: risk.summary,
    overallRiskScore: risk.score,
    riskLevel: risk.riskLevel,
    findings: risk.findings,
    warnings,
    cbom,
    assets,
    recommendation,
    raw: {
      tls: tlsRaw.raw,
      dependency: dependencyRaw.raw,
      crypto: cryptoRaw.raw,
      api: apiRaw.raw || ''
    }
  };
}
