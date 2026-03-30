import {Scan} from '../models/Scan.js';
import ReportSchedule from '../models/ReportSchedule.js';
import GeneratedReport from '../models/GeneratedReport.js';
import {Asset} from '../models/Asset.js';
import AssetRelation from '../models/AssetRelation.js';
import CBOMSnapshot from '../models/CBOMSnapshot.js';
import { generateAiSummary } from '../services/ai/dashboardAiService.js';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assetDisplayName, derivePqc, deriveSeverity } from '../utils/securityDerivation.js';
import { env } from '../config/env.js';

function getUserId(req) {
  return req.user?._id || req.user?.id || null;
}

function normalizeEmailList(input) {
  const raw = Array.isArray(input) ? input : [input];

  return raw
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeDelivery(deliveryInput = {}) {
  const delivery = deliveryInput && typeof deliveryInput === 'object' ? deliveryInput : {};
  const format = String(delivery.format || 'pdf').toLowerCase();

  return {
    email: normalizeEmailList(delivery.email),
    savePath: String(delivery.savePath || '').trim(),
    format: ['pdf', 'json', 'csv'].includes(format) ? format : 'pdf',
    downloadableLink: Boolean(delivery.downloadableLink),
  };
}

function computeFirstRunAt(nextRunAtInput, frequency) {
  const parsed = new Date(nextRunAtInput);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const now = new Date();
  const firstRun = new Date(parsed);

  // Never schedule in the past; shift to the next valid cycle if needed.
  while (firstRun <= now) {
    if (frequency === 'daily') firstRun.setDate(firstRun.getDate() + 1);
    else if (frequency === 'weekly') firstRun.setDate(firstRun.getDate() + 7);
    else firstRun.setMonth(firstRun.getMonth() + 1);
  }

  return firstRun;
}

let reportMailTransport = null;

function hasSmtpConfig() {
  return Boolean(env.smtpHost && env.smtpPort && env.smtpFrom && env.smtpUser && env.smtpPass);
}

function getMailTransport() {
  if (!hasSmtpConfig()) return null;
  if (reportMailTransport) return reportMailTransport;

  reportMailTransport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });

  return reportMailTransport;
}

function projectRootPath() {
  const cwd = process.cwd();
  return path.basename(cwd) === 'backend' ? path.resolve(cwd, '..') : cwd;
}

function resolveSaveDirectory(savePath = '') {
  const raw = String(savePath || '').trim();
  if (!raw) return '';

  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }

  const sanitized = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');

  if (!sanitized) {
    throw new Error('Save path is invalid.');
  }

  return path.resolve(projectRootPath(), sanitized);
}

function jsonToCsvRow(values) {
  return values
    .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
    .join(',');
}

function bestAssetTarget(asset = {}) {
  return (
    asset.target ||
    asset.url ||
    asset.domain ||
    asset.hostname ||
    asset.ipAddress ||
    asset.name ||
    ''
  );
}

function normalizeAssetType(asset = {}) {
  return normalize(asset.assetType || asset.type || 'unknown') || 'unknown';
}

function isCryptoAsset(asset = {}) {
  return Boolean(
    asset.tlsVersion ||
      asset.protocol ||
      asset.cipherSuite ||
      asset.cipher ||
      asset.keyExchange ||
      asset.signature ||
      asset.keyLength ||
      asset.certificateAuthority ||
      asset.commonName ||
      asset.validTo ||
      asset.expiresAt
  );
}

function incrementMap(map, key) {
  const normalizedKey = String(key || '').trim() || 'unknown';
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + 1);
}

function toDistribution(map, limit = 12) {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function buildFunctionalSections(assets = [], scan = null) {
  const inventoryTypeMap = new Map();
  const inventoryStatusMap = new Map();
  const cbomProtocolMap = new Map();
  const cbomCipherMap = new Map();
  const cbomKeyLengthMap = new Map();
  const cbomIssuerMap = new Map();
  const discoveryTypeMap = new Map();
  const pqcSupportMap = new Map();
  const pqcGradeMap = new Map();
  const pqcMigrationMap = new Map();
  const discoveryHosts = new Set();
  const discoveryTargets = new Set();

  const cbomAssets = [];
  const discoveryAssets = [];
  const pqcAssets = [];

  for (const asset of assets) {
    const type = normalizeAssetType(asset);
    const status = normalize(asset.status) || 'unknown';
    const severity = deriveSeverity(asset);
    const pqc = derivePqc(asset) || {};
    const supportStatus = normalize(pqc.supportStatus) || 'unknown';
    const grade = normalize(pqc.grade) || 'unknown';
    const migrationPriority = String(pqc.migrationPriority || '').trim() || 'Low';
    const target = bestAssetTarget(asset);
    const host = String(asset.hostname || asset.domain || '').trim();

    incrementMap(inventoryTypeMap, type);
    incrementMap(inventoryStatusMap, status);

    if (host) discoveryHosts.add(host.toLowerCase());
    if (target) discoveryTargets.add(target.toLowerCase());

    incrementMap(discoveryTypeMap, type);

    incrementMap(pqcSupportMap, supportStatus);
    incrementMap(pqcGradeMap, grade);
    incrementMap(pqcMigrationMap, migrationPriority);

    if (isCryptoAsset(asset)) {
      const protocol = String(asset.tlsVersion || asset.protocol || asset.metadata?.tlsVersion || '').trim() || 'unknown';
      const cipher = String(asset.cipherSuite || asset.cipher || asset.metadata?.cipherSuite || '').trim() || 'unknown';
      const keyLength = String(asset.keyLength || asset.metadata?.keyLength || '').trim() || 'unknown';
      const issuer = String(asset.certificateAuthority || asset.issuer || '').trim() || 'unknown';

      incrementMap(cbomProtocolMap, protocol);
      incrementMap(cbomCipherMap, cipher);
      incrementMap(cbomKeyLengthMap, keyLength);
      incrementMap(cbomIssuerMap, issuer);

      cbomAssets.push({
        name: assetDisplayName(asset),
        type,
        severity,
        status,
        target,
        protocol,
        cipher,
        keyLength,
        issuer,
        validTo: asset.validTo || asset.expiresAt || null,
      });
    }

    if (['domain', 'api', 'ip', 'server', 'webapp'].includes(type)) {
      discoveryAssets.push({
        name: assetDisplayName(asset),
        type,
        severity,
        status,
        target,
        host,
        ipAddress: asset.ipAddress || '',
        source: asset.source || asset.metadata?.source || '-',
      });
    }

    pqcAssets.push({
      name: assetDisplayName(asset),
      type,
      severity,
      status,
      target,
      supportStatus,
      grade,
      migrationPriority,
      keyLength: String(asset.keyLength || asset.metadata?.keyLength || '').trim() || '-',
      tlsVersion: String(asset.tlsVersion || asset.protocol || '').trim() || '-',
      cipherSuite: String(asset.cipherSuite || asset.cipher || '').trim() || '-',
    });
  }

  const riskSummary = buildExecutiveMetrics(assets);

  return {
    risk: {
      score: Number(scan?.overallRiskScore || 0),
      level: scan?.riskLevel || '-',
      summary: riskSummary,
      topRiskyAssets: riskSummary.topRiskyAssets,
      recommendedActions: buildActionPlan(riskSummary),
    },
    cbom: {
      cryptoAssetCount: cbomAssets.length,
      weakProtocolCount: riskSummary.weakProtocolCount,
      weakCipherCount: riskSummary.weakCipherCount,
      expiredCertificates: riskSummary.expiredCertificates,
      expiringCertificates30d: riskSummary.expiringCertificates30d,
      protocolDistribution: toDistribution(cbomProtocolMap),
      cipherDistribution: toDistribution(cbomCipherMap),
      keyLengthDistribution: toDistribution(cbomKeyLengthMap),
      issuerDistribution: toDistribution(cbomIssuerMap),
      assets: cbomAssets.slice(0, 500),
    },
    inventory: {
      totalAssets: assets.length,
      byType: toDistribution(inventoryTypeMap),
      byStatus: toDistribution(inventoryStatusMap),
      assets: assets.slice(0, 800).map((asset) => ({
        id: String(asset._id || ''),
        name: assetDisplayName(asset),
        type: normalizeAssetType(asset),
        severity: deriveSeverity(asset),
        status: normalize(asset.status) || 'unknown',
        target: bestAssetTarget(asset),
        domain: asset.domain || '',
        hostname: asset.hostname || '',
        ipAddress: asset.ipAddress || '',
      })),
    },
    discovery: {
      discoveredTargets: discoveryTargets.size,
      uniqueHosts: discoveryHosts.size,
      byType: toDistribution(discoveryTypeMap),
      assets: discoveryAssets.slice(0, 500),
    },
    pqc: {
      supportDistribution: toDistribution(pqcSupportMap),
      gradeDistribution: toDistribution(pqcGradeMap),
      migrationPriorityDistribution: toDistribution(pqcMigrationMap),
      assets: pqcAssets.slice(0, 500),
    },
  };
}

function buildStructuredReportPayload(report, assets = [], scan = null) {
  const sections = buildFunctionalSections(assets, scan);

  return {
    report: {
      id: String(report._id || ''),
      reportType: report.reportType,
      format: report.format,
      generatedAt: report.createdAt,
      deliveryStatus: report.deliveryStatus || 'generated',
      includedSections: report.includedSections || [],
      assetScope: report.metadata?.assetScope || 'all',
    },
    scan: scan
      ? {
          id: String(scan._id || ''),
          name: scan.name || '',
          target: scan.target || scan.domain || scan.apiEndpoint || '',
          riskScore: Number(scan.overallRiskScore || 0),
          riskLevel: scan.riskLevel || '-',
          findings: scan.findings || [],
        }
      : null,
    executiveSummary:
      report.aiExecutiveSummary ||
      'Summary is not available for this report. Review risk indicators and remediation actions from the dashboard.',
    generatedAt: report.createdAt,
    assetsCount: assets.length,
    sections,
    assets: assets.slice(0, 1500).map((asset) => {
      const pqc = derivePqc(asset) || {};
      return {
        id: String(asset._id || ''),
        name: assetDisplayName(asset),
        type: normalizeAssetType(asset),
        severity: deriveSeverity(asset),
        status: normalize(asset.status) || 'unknown',
        target: bestAssetTarget(asset),
        hostname: asset.hostname || '',
        domain: asset.domain || '',
        ipAddress: asset.ipAddress || '',
        tlsVersion: asset.tlsVersion || asset.protocol || '',
        cipherSuite: asset.cipherSuite || asset.cipher || '',
        keyExchange: asset.keyExchange || '',
        keyLength: asset.keyLength || '',
        certificateAuthority: asset.certificateAuthority || asset.issuer || '',
        validTo: asset.validTo || asset.expiresAt || null,
        pqcSupport: pqc.supportStatus || '',
        pqcGrade: pqc.grade || '',
        pqcMigrationPriority: pqc.migrationPriority || '',
        findings: Array.isArray(asset.findings) ? asset.findings : [],
      };
    }),
  };
}

function buildStructuredCsv(payload) {
  const rows = [];
  const header = [
    'section',
    'recordType',
    'name',
    'type',
    'severity',
    'status',
    'target',
    'host',
    'ipAddress',
    'tlsVersion',
    'cipherSuite',
    'keyLength',
    'certificateAuthority',
    'pqcSupport',
    'pqcGrade',
    'migrationPriority',
    'metric',
    'value',
    'notes',
  ];

  const pushMetric = (section, metric, value, notes = '') => {
    rows.push(
      jsonToCsvRow([
        section,
        'metric',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        metric,
        value,
        notes,
      ])
    );
  };

  const pushAsset = (section, asset = {}, notes = '') => {
    rows.push(
      jsonToCsvRow([
        section,
        'asset',
        asset.name || '',
        asset.type || '',
        asset.severity || '',
        asset.status || '',
        asset.target || '',
        asset.host || asset.hostname || asset.domain || '',
        asset.ipAddress || '',
        asset.tlsVersion || asset.protocol || '',
        asset.cipherSuite || asset.cipher || '',
        asset.keyLength || '',
        asset.certificateAuthority || asset.issuer || '',
        asset.supportStatus || asset.pqcSupport || '',
        asset.grade || asset.pqcGrade || '',
        asset.migrationPriority || asset.pqcMigrationPriority || '',
        '',
        '',
        notes,
      ])
    );
  };

  const summary = payload.sections?.risk?.summary || {};
  const cbom = payload.sections?.cbom || {};
  const inventory = payload.sections?.inventory || {};
  const discovery = payload.sections?.discovery || {};
  const pqc = payload.sections?.pqc || {};

  pushMetric('report', 'report_type', payload.report?.reportType || '');
  pushMetric('report', 'generated_at', payload.generatedAt || '');
  pushMetric('report', 'assets_count', payload.assetsCount || 0);
  pushMetric('risk', 'critical_assets', summary.severityBreakdown?.critical || 0);
  pushMetric('risk', 'high_assets', summary.severityBreakdown?.high || 0);
  pushMetric('risk', 'moderate_assets', summary.severityBreakdown?.moderate || 0);
  pushMetric('risk', 'low_assets', summary.severityBreakdown?.low || 0);
  pushMetric('risk', 'weak_protocol_count', summary.weakProtocolCount || 0);
  pushMetric('risk', 'weak_cipher_count', summary.weakCipherCount || 0);
  pushMetric('risk', 'expired_certificates', summary.expiredCertificates || 0);
  pushMetric('risk', 'expiring_certificates_30d', summary.expiringCertificates30d || 0);

  pushMetric('cbom', 'crypto_assets', cbom.cryptoAssetCount || 0);
  pushMetric('cbom', 'weak_protocol_findings', cbom.weakProtocolCount || 0);
  pushMetric('cbom', 'weak_cipher_findings', cbom.weakCipherCount || 0);

  (inventory.byType || []).forEach((item) => pushMetric('inventory', `type_${item.label}`, item.value));
  (inventory.byStatus || []).forEach((item) => pushMetric('inventory', `status_${item.label}`, item.value));
  (discovery.byType || []).forEach((item) => pushMetric('discovery', `type_${item.label}`, item.value));
  (pqc.supportDistribution || []).forEach((item) => pushMetric('pqc', `support_${item.label}`, item.value));
  (pqc.gradeDistribution || []).forEach((item) => pushMetric('pqc', `grade_${item.label}`, item.value));

  (payload.sections?.risk?.topRiskyAssets || []).slice(0, 100).forEach((asset) => {
    pushAsset('risk_top_assets', asset);
  });

  (cbom.assets || []).slice(0, 400).forEach((asset) => {
    pushAsset('cbom_assets', asset, asset.validTo ? `valid_to=${new Date(asset.validTo).toISOString()}` : '');
  });

  (inventory.assets || []).slice(0, 600).forEach((asset) => {
    pushAsset('inventory_assets', asset);
  });

  (discovery.assets || []).slice(0, 400).forEach((asset) => {
    pushAsset('discovery_assets', asset, asset.source ? `source=${asset.source}` : '');
  });

  (pqc.assets || []).slice(0, 400).forEach((asset) => {
    pushAsset('pqc_assets', asset);
  });

  (payload.assets || []).slice(0, 1200).forEach((asset) => {
    pushAsset('all_assets', asset);
  });

  return [jsonToCsvRow(header), ...rows].join('\n');
}

function classifyInventoryType(asset = {}) {
  const type = normalizeAssetType(asset);
  if (type.includes('domain')) return 'domain';
  if (type.includes('cert')) return 'certificate';
  if (type.includes('ip') || type.includes('subnet') || type === 'server') return 'ip';
  if (type.includes('software') || type.includes('webapp') || type === 'api') return 'software';
  return 'other';
}

async function buildPdfReportTypeData({ reportType, userId = null, scan = null, assets = [], payload }) {
  const sections = payload.sections || {};
  const riskSummary = sections.risk?.summary || buildExecutiveMetrics(assets);

  const inventorySummary = {
    domain: 0,
    certificate: 0,
    ip: 0,
    software: 0,
    other: 0,
  };

  for (const asset of assets) {
    const bucket = classifyInventoryType(asset);
    inventorySummary[bucket] += 1;
  }

  let relationCount = 0;
  if (scan?._id) {
    relationCount = await AssetRelation.countDocuments({ scanId: scan._id });
  }

  let cbomSnapshot = null;
  if (userId) {
    if (scan?._id) {
      cbomSnapshot = await CBOMSnapshot.findOne({ userId, scanId: scan._id }).sort({ createdAt: -1 }).lean();
    }
    if (!cbomSnapshot) {
      cbomSnapshot = await CBOMSnapshot.findOne({ userId, scanId: null }).sort({ createdAt: -1 }).lean();
    }
  }

  const scorecard = scan?.scorecard || {};
  const cyberRating = {
    normalizedScore: Number(scorecard.normalizedScore || 0),
    label: scorecard.label || '-',
    factors: Array.isArray(scorecard.factors) ? scorecard.factors : [],
    urlScores: Array.isArray(scorecard.urlScores) ? scorecard.urlScores : [],
    weakProtocolFindings: riskSummary.weakProtocolCount || 0,
    weakCipherFindings: riskSummary.weakCipherCount || 0,
    expiredCertificates: riskSummary.expiredCertificates || 0,
  };

  const discoveryHighlights = (sections.discovery?.assets || [])
    .filter((asset) => asset.severity === 'critical' || asset.severity === 'high')
    .slice(0, 15);

  return {
    reportType,
    inventorySummary,
    relationCount,
    cbomSnapshot,
    cyberRating,
    discoveryHighlights,
    sections,
  };
}

function renderDistribution(doc, label, items = [], limit = 8) {
  if (!items.length) {
    bullet(doc, `${label}: no data available`);
    return;
  }

  items.slice(0, limit).forEach((item) => {
    bullet(doc, `${label} ${item.label}: ${item.value}`);
  });
}

function renderReportContext(doc, report, scan, assetsCount) {
  sectionTitle(doc, 'Report Context');
  metricLine(doc, 'Report Type', report.reportType || '-');
  metricLine(doc, 'Generated At', new Date(report.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  metricLine(doc, 'Format', String(report.format || 'pdf').toUpperCase());
  metricLine(doc, 'Assets in Scope', assetsCount);
  if (scan) {
    metricLine(doc, 'Source Scan', scan.name || scan.target || scan.domain || scan.apiEndpoint || String(scan._id));
    metricLine(doc, 'Risk Score', `${Number(scan.overallRiskScore || 0).toFixed(1)} / 100`);
    metricLine(doc, 'Risk Level', scan.riskLevel || '-');
  }
}

function renderExecutivePdf(doc, payload) {
  const summary = payload.sections.risk?.summary || {};

  sectionTitle(doc, 'Executive Summary');
  doc.text(payload.executiveSummary || '-');

  sectionTitle(doc, 'Risk Snapshot');
  metricLine(doc, 'Critical Assets', summary.severityBreakdown?.critical || 0);
  metricLine(doc, 'High Assets', summary.severityBreakdown?.high || 0);
  metricLine(doc, 'Moderate Assets', summary.severityBreakdown?.moderate || 0);
  metricLine(doc, 'Low Assets', summary.severityBreakdown?.low || 0);
  metricLine(doc, 'Weak Protocol Findings', summary.weakProtocolCount || 0);
  metricLine(doc, 'Weak Cipher Findings', summary.weakCipherCount || 0);

  sectionTitle(doc, 'Action Plan');
  (payload.sections.risk?.recommendedActions || []).forEach((action) => bullet(doc, action));

  sectionTitle(doc, 'Top At-Risk Assets');
  const risky = payload.sections.risk?.topRiskyAssets || [];
  if (!risky.length) {
    bullet(doc, 'No critical/high-risk assets detected in this report scope.');
    return;
  }

  risky.slice(0, 20).forEach((item, index) => {
    bullet(doc, `${index + 1}. ${item.name} | Type: ${item.type} | Severity: ${item.severity} | Status: ${item.status}`);
  });
}

function renderInventoryPdf(doc, payload, typeData) {
  sectionTitle(doc, 'Inventory Overview');
  metricLine(doc, 'Total Assets', payload.assetsCount);
  metricLine(doc, 'Domains', typeData.inventorySummary.domain);
  metricLine(doc, 'Certificates', typeData.inventorySummary.certificate);
  metricLine(doc, 'IP/Subnet', typeData.inventorySummary.ip);
  metricLine(doc, 'Software/API', typeData.inventorySummary.software);

  sectionTitle(doc, 'Inventory by Type');
  renderDistribution(doc, 'Type', payload.sections.inventory?.byType || []);

  sectionTitle(doc, 'Inventory by Status');
  renderDistribution(doc, 'Status', payload.sections.inventory?.byStatus || []);

  sectionTitle(doc, 'Inventory Assets (Top 40)');
  (payload.sections.inventory?.assets || []).slice(0, 40).forEach((asset, index) => {
    bullet(doc, `${index + 1}. ${asset.name} | ${asset.type} | ${asset.status} | ${asset.target || '-'}`);
  });
}

function renderDiscoveryPdf(doc, payload, typeData) {
  sectionTitle(doc, 'Discovery Graph Snapshot');
  metricLine(doc, 'Discovery Nodes (Assets)', payload.sections.discovery?.assets?.length || 0);
  metricLine(doc, 'Discovery Edges (Relations)', typeData.relationCount || 0);
  metricLine(doc, 'Discovered Targets', payload.sections.discovery?.discoveredTargets || 0);
  metricLine(doc, 'Unique Hosts', payload.sections.discovery?.uniqueHosts || 0);

  sectionTitle(doc, 'Discovery Asset Types');
  renderDistribution(doc, 'Type', payload.sections.discovery?.byType || []);

  sectionTitle(doc, 'Discovery Highlights');
  if (!typeData.discoveryHighlights.length) {
    bullet(doc, 'No high-severity discovery highlights in current scope.');
  } else {
    typeData.discoveryHighlights.forEach((item, index) => {
      bullet(doc, `${index + 1}. ${item.name} | ${item.type} | Severity: ${item.severity} | Source: ${item.source || '-'}`);
    });
  }

  sectionTitle(doc, 'Discovery Assets (Top 40)');
  (payload.sections.discovery?.assets || []).slice(0, 40).forEach((asset, index) => {
    bullet(doc, `${index + 1}. ${asset.name} | ${asset.type} | Host: ${asset.host || '-'} | Target: ${asset.target || '-'}`);
  });
}

function renderCbomPdf(doc, payload, typeData) {
  const cbom = payload.sections.cbom || {};

  sectionTitle(doc, 'CBOM Overview');
  metricLine(doc, 'Crypto Assets', cbom.cryptoAssetCount || 0);
  metricLine(doc, 'Weak Protocol Findings', cbom.weakProtocolCount || 0);
  metricLine(doc, 'Weak Cipher Findings', cbom.weakCipherCount || 0);
  metricLine(doc, 'Expired Certificates', cbom.expiredCertificates || 0);
  metricLine(doc, 'Expiring <=30d', cbom.expiringCertificates30d || 0);

  sectionTitle(doc, 'Protocol Distribution');
  renderDistribution(doc, 'Protocol', cbom.protocolDistribution || []);

  sectionTitle(doc, 'Cipher Distribution');
  renderDistribution(doc, 'Cipher', cbom.cipherDistribution || []);

  sectionTitle(doc, 'Key Length Distribution');
  renderDistribution(doc, 'Key Length', cbom.keyLengthDistribution || []);

  sectionTitle(doc, 'Certificate Authorities');
  renderDistribution(doc, 'Authority', cbom.issuerDistribution || []);

  if (typeData.cbomSnapshot?.aiSummary) {
    sectionTitle(doc, 'CBOM AI Summary');
    doc.text(typeData.cbomSnapshot.aiSummary);
  }

  sectionTitle(doc, 'CBOM Asset Rows (Top 40)');
  (cbom.assets || []).slice(0, 40).forEach((asset, index) => {
    bullet(
      doc,
      `${index + 1}. ${asset.name} | TLS: ${asset.protocol} | Cipher: ${asset.cipher} | Key: ${asset.keyLength} | Issuer: ${asset.issuer}`
    );
  });
}

function renderPqcPdf(doc, payload) {
  sectionTitle(doc, 'PQC Overview');
  renderDistribution(doc, 'Support', payload.sections.pqc?.supportDistribution || []);
  renderDistribution(doc, 'Grade', payload.sections.pqc?.gradeDistribution || []);
  renderDistribution(doc, 'Priority', payload.sections.pqc?.migrationPriorityDistribution || []);

  sectionTitle(doc, 'PQC Critical/Legacy Assets');
  const lagging = (payload.sections.pqc?.assets || []).filter(
    (asset) => normalize(asset.grade) === 'critical' || normalize(asset.grade) === 'legacy'
  );

  if (!lagging.length) {
    bullet(doc, 'No critical or legacy PQC assets detected in this report scope.');
  } else {
    lagging.slice(0, 40).forEach((asset, index) => {
      bullet(
        doc,
        `${index + 1}. ${asset.name} | Grade: ${asset.grade} | Support: ${asset.supportStatus} | Priority: ${asset.migrationPriority}`
      );
    });
  }
}

function renderCyberRatingPdf(doc, payload, typeData) {
  const rating = typeData.cyberRating;

  sectionTitle(doc, 'Enterprise Cyber Rating');
  metricLine(doc, 'Normalized Score', `${Math.max(0, Math.min(1000, Math.round(rating.normalizedScore || 0)))} / 1000`);
  metricLine(doc, 'Label', rating.label || '-');
  metricLine(doc, 'Weak Protocol Findings', rating.weakProtocolFindings || 0);
  metricLine(doc, 'Weak Cipher Findings', rating.weakCipherFindings || 0);
  metricLine(doc, 'Expired Certificates', rating.expiredCertificates || 0);

  sectionTitle(doc, 'Score Contributors');
  if (!rating.factors.length) {
    bullet(doc, 'No factor breakdown available for this scan.');
  } else {
    rating.factors.slice(0, 12).forEach((factor, index) => {
      bullet(doc, `${index + 1}. ${factor.label || factor.name || 'Factor'}: ${factor.value ?? '-'}`);
    });
  }

  sectionTitle(doc, 'URL/Asset Scores');
  if (!rating.urlScores.length) {
    bullet(doc, 'No URL/asset score entries available for this scan.');
  } else {
    rating.urlScores.slice(0, 30).forEach((item, index) => {
      bullet(doc, `${index + 1}. ${item.url || item.asset || '-'}: ${item.score ?? '-'}`);
    });
  }
}

async function buildOnDemandPdfBuffer(report, assets = [], scan = null, options = {}) {
  const payload = buildStructuredReportPayload(report, assets, scan);
  const typeData = await buildPdfReportTypeData({
    reportType: normalize(report.reportType),
    userId: options.userId || null,
    scan,
    assets,
    payload,
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    const trimmedPassword = String(options.reportPassword || '').trim();
    const usePassword = Boolean(options.passwordProtect && trimmedPassword);
    const doc = new PDFDocument({
      margin: 48,
      ...(usePassword
        ? {
            userPassword: trimmedPassword,
            ownerPassword: `owner-${String(report._id || 'report')}`,
          }
        : {}),
    });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const riskSummary = payload.sections?.risk?.summary || {};
    drawReportHero(doc, report, scan, assets.length);
    drawMetricRibbon(doc, [
      { label: 'Critical', value: riskSummary.severityBreakdown?.critical || 0 },
      { label: 'High', value: riskSummary.severityBreakdown?.high || 0 },
      { label: 'Weak Protocol', value: riskSummary.weakProtocolCount || 0 },
      { label: 'Expiring <=30d', value: riskSummary.expiringCertificates30d || 0 },
    ]);

    renderReportContext(doc, report, scan, assets.length);

    const reportType = normalize(report.reportType);
    if (reportType === 'asset-discovery') {
      renderDiscoveryPdf(doc, payload, typeData);
    } else if (reportType === 'asset-inventory') {
      renderInventoryPdf(doc, payload, typeData);
    } else if (reportType === 'cbom') {
      renderCbomPdf(doc, payload, typeData);
    } else if (reportType === 'pqc-posture') {
      renderPqcPdf(doc, payload);
    } else if (reportType === 'cyber-rating') {
      renderCyberRatingPdf(doc, payload, typeData);
    } else {
      renderExecutivePdf(doc, payload);
    }

    doc.end();
  });
}

async function buildGeneratedAttachment(report, assets = [], options = {}) {
  const format = String(report.format || 'pdf').toLowerCase();
  const safeType = String(report.reportType || 'report').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const baseName = `${safeType}-${report._id}`;
  const payload = buildStructuredReportPayload(report, assets, options.scan || null);

  if (format === 'json') {
    return {
      filename: `${baseName}.json`,
      contentType: 'application/json',
      content: Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'),
    };
  }

  if (format === 'csv') {
    const csv = buildStructuredCsv(payload);
    return {
      filename: `${baseName}.csv`,
      contentType: 'text/csv',
      content: Buffer.from(csv, 'utf-8'),
    };
  }

  return {
    filename: `${baseName}.pdf`,
    contentType: 'application/pdf',
    content: await buildOnDemandPdfBuffer(report, assets, options.scan || null, options),
  };
}

async function persistGeneratedAttachment(savePath, attachment) {
  const targetDir = resolveSaveDirectory(savePath);

  if (!targetDir) {
    throw new Error('Save path is required.');
  }

  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch {
    throw new Error(`Unable to access save path: ${savePath}`);
  }

  const outputPath = path.resolve(targetDir, attachment.filename);

  try {
    await fs.writeFile(outputPath, attachment.content);
  } catch {
    throw new Error(`Unable to write report file in path: ${savePath}`);
  }

  return outputPath;
}

async function sendOnDemandEmail({ recipients = [], report, attachment }) {
  const smtp = getMailTransport();
  const to = normalizeEmailList(recipients);

  if (!smtp || !to.length) {
    return false;
  }

  await smtp.sendMail({
    from: env.smtpFrom,
    to: to.join(', '),
    envelope: {
      from: env.smtpFrom,
      to,
    },
    subject: `[Quantum Scanner] On-Demand ${String(report.reportType || '').toUpperCase()} Report`,
    text:
      `On-demand report generated successfully.\n\n` +
      `Report Type: ${report.reportType}\n` +
      `Format: ${String(report.format || '').toUpperCase()}\n` +
      `Generated: ${new Date(report.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n` +
      `Please find the attachment.`,
    attachments: [attachment],
  });

  return true;
}

const normalize = (value) => String(value || '').trim().toLowerCase();
const severityRank = { critical: 4, high: 3, moderate: 2, low: 1 };
const palette = {
  brand: '#0B3558',
  accent: '#00A3A3',
  accentSoft: '#C6F2EE',
  warm: '#F2B03D',
  ink: '#1D2939',
  muted: '#667085',
  border: '#D8E4EE',
  tileBg: '#F5FAFF',
  paper: '#FCFEFF',
  shadow: '#E8EEF5',
};

function ensureSpace(doc, minHeight = 70) {
  if (doc.y > doc.page.height - minHeight) {
    doc.addPage();
    doc
      .save()
      .fillColor(palette.paper)
      .rect(0, 0, doc.page.width, doc.page.height)
      .fill()
      .restore();

    const x = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc
      .save()
      .fillColor('#EAF2F9')
      .roundedRect(x, 26, width, 12, 6)
      .fill()
      .restore();
    doc.y = 48;
  }
}

function drawReportHero(doc, report, scan, assetsCount) {
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = 126;

  doc
    .save()
    .roundedRect(x, y, width, height, 14)
    .fill('#0B3558')
    .restore();

  doc
    .save()
    .fillColor('#0E456E')
    .circle(x + width - 54, y + 28, 34)
    .fill()
    .fillColor('#16608F')
    .circle(x + width - 20, y + 88, 24)
    .fill()
    .restore();

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('Quantum Scanner', x + 18, y + 20);
  doc.fillColor('#E4F6FF').font('Helvetica').fontSize(12).text('Security Intelligence Report', x + 18, y + 47);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#C9E8F6')
    .text(`Type: ${report.reportType || '-'}`, x + 18, y + 70)
    .text(`Generated: ${new Date(report.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, x + 18, y + 84)
    .text(`Assets: ${assetsCount}${scan ? `  |  Risk Score: ${Number(scan.overallRiskScore || 0).toFixed(1)} / 100` : ''}`, x + 18, y + 98);

  doc.y = y + height + 12;
}

function drawMetricRibbon(doc, items = []) {
  if (!items.length) return;
  ensureSpace(doc, 98);

  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 10;
  const safeItems = items.slice(0, 4);
  const tileWidth = (width - gap * (safeItems.length - 1)) / safeItems.length;
  const tileHeight = 68;

  safeItems.forEach((item, index) => {
    const tileX = x + index * (tileWidth + gap);
    doc
      .save()
      .roundedRect(tileX, y, tileWidth, tileHeight, 10)
      .fillAndStroke(palette.tileBg, palette.border)
      .restore();

    doc
      .fillColor(palette.muted)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(item.label, tileX + 10, y + 10, { width: tileWidth - 20 });
    doc
      .fillColor(palette.brand)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(String(item.value), tileX + 10, y + 30, { width: tileWidth - 20 });
  });

  doc.y = y + tileHeight + 10;
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 84);
  doc.moveDown(0.55);
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const h = 30;

  doc
    .save()
    .roundedRect(x, y, width, h, 9)
    .fillAndStroke('#EFF8FF', palette.border)
    .restore();

  doc
    .save()
    .roundedRect(x + 8, y + 8, 14, 14, 4)
    .fill(palette.accent)
    .restore();

  doc.fillColor(palette.brand).font('Helvetica-Bold').fontSize(13).text(title, x + 30, y + 8);
  doc.y = y + h + 5;
  doc.fillColor(palette.ink).font('Helvetica').fontSize(11);
}

function metricLine(doc, label, value) {
  ensureSpace(doc, 34);
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const h = 22;

  doc
    .save()
    .roundedRect(x, y, width, h, 6)
    .fillAndStroke('#FFFFFF', '#EDF2F7')
    .restore();

  doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(10).text(label, x + 10, y + 6);
  doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(10).text(String(value), x + width - 180, y + 6, {
    width: 170,
    align: 'right',
  });
  doc.y = y + h + 4;
}

function bullet(doc, text) {
  ensureSpace(doc, 28);
  const x = doc.page.margins.left;
  const y = doc.y;
  doc
    .save()
    .fillColor(palette.accent)
    .circle(x + 4, y + 7, 2.5)
    .fill()
    .restore();
  doc.fillColor(palette.ink).font('Helvetica').fontSize(10.5).text(text, x + 14, y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14,
  });
}

function drawHeaderBanner(doc, report, scan, metrics) {
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = 96;

  doc.save();
  doc.roundedRect(x, y, width, height, 10).fill(palette.brand);
  doc.restore();

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(21).text('Quantum Scanner Executive Report', x + 18, y + 16);
  doc.font('Helvetica').fontSize(10).fillColor('#EAF3FA');
  doc.text(`Generated: ${new Date(report.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, x + 18, y + 48);
  doc.text(`Type: ${report.reportType || '-'}  |  Format: ${(report.format || 'pdf').toUpperCase()}`, x + 18, y + 63);
  doc.text(
    `Assets: ${metrics.totalAssets}${scan ? `  |  Risk Score: ${Number(scan.overallRiskScore || 0).toFixed(1)} / 100` : ''}`,
    x + 18,
    y + 76
  );

  doc.y = y + height + 14;
  doc.fillColor(palette.ink);
}

function drawKpiTiles(doc, tiles) {
  ensureSpace(doc, 110);
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 10;
  const tileWidth = (width - gap * (tiles.length - 1)) / tiles.length;
  const tileHeight = 76;

  tiles.forEach((tile, index) => {
    const tileX = x + index * (tileWidth + gap);
    doc.save();
    doc.roundedRect(tileX, y, tileWidth, tileHeight, 8).fillAndStroke(palette.tileBg, palette.border);
    doc.restore();

    doc.fillColor(palette.accent).font('Helvetica-Bold').fontSize(10).text(tile.label, tileX + 10, y + 12, {
      width: tileWidth - 20,
      align: 'left',
    });
    doc.fillColor(palette.brand).font('Helvetica-Bold').fontSize(18).text(String(tile.value), tileX + 10, y + 34, {
      width: tileWidth - 20,
      align: 'left',
    });
  });

  doc.y = y + tileHeight + 12;
  doc.fillColor(palette.ink).font('Helvetica').fontSize(11);
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function buildExecutiveMetrics(assets = []) {
  const severityBreakdown = { critical: 0, high: 0, moderate: 0, low: 0 };
  const pqcReadiness = { ready: 0, partial: 0, legacy: 0, critical: 0, unknown: 0 };
  const statusBreakdown = { new: 0, confirmed: 0, resolved: 0, false_positive: 0, unknown: 0 };
  const assetTypeCounts = {};

  let weakProtocolCount = 0;
  let weakCipherCount = 0;
  let expiringCertificates30d = 0;
  let expiredCertificates = 0;

  const riskyAssets = [];

  for (const asset of assets) {
    const severity = deriveSeverity(asset);
    severityBreakdown[severity] += 1;

    const support = normalize(derivePqc(asset)?.supportStatus);
    if (pqcReadiness[support] !== undefined) pqcReadiness[support] += 1;
    else pqcReadiness.unknown += 1;

    const status = normalize(asset.status);
    if (statusBreakdown[status] !== undefined) statusBreakdown[status] += 1;
    else statusBreakdown.unknown += 1;

    const type = normalize(asset.assetType) || 'unknown';
    assetTypeCounts[type] = (assetTypeCounts[type] || 0) + 1;

    const protocol = normalize(asset.tlsVersion || asset.protocol || asset.metadata?.tlsVersion);
    const cipher = normalize(asset.cipherSuite || asset.cipher || asset.metadata?.cipher);

    if (protocol.includes('ssl') || protocol.includes('1.0') || protocol.includes('1.1')) {
      weakProtocolCount += 1;
    }

    if (['3des', 'rc4', 'des', 'md5', 'sha1', 'cbc'].some((bad) => cipher.includes(bad))) {
      weakCipherCount += 1;
    }

    const daysLeft = daysUntil(asset.validTo || asset.expiresAt || asset.metadata?.validTo);
    if (daysLeft !== null) {
      if (daysLeft < 0) expiredCertificates += 1;
      else if (daysLeft <= 30) expiringCertificates30d += 1;
    }

    if (severity === 'critical' || severity === 'high') {
      riskyAssets.push({
        name: assetDisplayName(asset),
        type,
        severity,
        support: support || 'unknown',
        status: normalize(asset.status) || 'unknown',
      });
    }
  }

  riskyAssets.sort((a, b) => {
    const sev = (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
    if (sev !== 0) return sev;

    const unresolvedA = a.status === 'resolved' ? 0 : 1;
    const unresolvedB = b.status === 'resolved' ? 0 : 1;
    if (unresolvedB !== unresolvedA) return unresolvedB - unresolvedA;

    return a.name.localeCompare(b.name);
  });

  const topAssetTypes = Object.entries(assetTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const unresolvedHighRisk = riskyAssets.filter((item) => item.status !== 'resolved').length;

  return {
    totalAssets: assets.length,
    severityBreakdown,
    pqcReadiness,
    statusBreakdown,
    topAssetTypes,
    weakProtocolCount,
    weakCipherCount,
    expiringCertificates30d,
    expiredCertificates,
    unresolvedHighRisk,
    topRiskyAssets: riskyAssets.slice(0, 12),
  };
}

function buildActionPlan(metrics) {
  const actions = [];

  if (metrics.severityBreakdown.critical > 0) {
    actions.push(
      `Start with ${metrics.severityBreakdown.critical} critical assets and validate owner-specific remediation plans within 24 hours.`
    );
  }

  if (metrics.unresolvedHighRisk > 0) {
    actions.push(
      `Create a focused closure sprint for ${metrics.unresolvedHighRisk} unresolved high-risk assets.`
    );
  }

  const pqcLagging = metrics.pqcReadiness.legacy + metrics.pqcReadiness.critical;
  if (pqcLagging > 0) {
    actions.push(
      `Prioritize PQC migration for ${pqcLagging} legacy/critical cryptographic assets and enforce TLS 1.2+ baseline controls.`
    );
  }

  if (metrics.expiredCertificates > 0 || metrics.expiringCertificates30d > 0) {
    actions.push(
      `Renew ${metrics.expiredCertificates} expired and ${metrics.expiringCertificates30d} soon-to-expire certificates to prevent service interruption.`
    );
  }

  if (metrics.weakProtocolCount > 0 || metrics.weakCipherCount > 0) {
    actions.push(
      `Eliminate weak protocol/cipher usage (${metrics.weakProtocolCount} protocol and ${metrics.weakCipherCount} cipher occurrences detected).`
    );
  }

  if (!actions.length) {
    actions.push('Current posture is stable; continue weekly review cycles and maintain baseline hardening controls.');
  }

  return actions.slice(0, 5);
}

export async function getReportingOptions(req, res) {
  res.json({
    reportTypes: [
      'executive-summary',
      'asset-discovery',
      'asset-inventory',
      'cbom',
      'pqc-posture',
      'cyber-rating',
    ],
    formats: ['pdf', 'json', 'csv'],
    frequencies: ['daily', 'weekly', 'monthly'],
  });
}

export async function generateReport(req, res, next) {
  try {
    const userId = getUserId(req);
    const {
      reportType,
      format = 'pdf',
      includeCharts = true,
      passwordProtect = false,
      reportPassword = '',
      assetScope = 'all',
      delivery = {},
      scanId = null,
    } = req.body;

    const normalizedFormat = String(format || 'pdf').toLowerCase();
    const trimmedReportPassword = String(reportPassword || '').trim();

    if (passwordProtect && normalizedFormat !== 'pdf') {
      return res.status(400).json({ message: 'Password-protected reports are currently supported only for PDF format.' });
    }

    if (passwordProtect && !trimmedReportPassword) {
      return res.status(400).json({ message: 'Password is required when password protection is enabled.' });
    }

    const normalizedDelivery = normalizeDelivery(delivery);

    const latestScan = scanId
      ? await Scan.findOne({ _id: scanId, userId }).lean()
      : await Scan.findOne({ userId }).sort({ createdAt: -1 }).lean();

    if (scanId && !latestScan) {
      return res.status(404).json({ message: 'Scan not found' });
    }

    const userScans = await Scan.find({ userId }).select('_id').lean();
    const userScanIds = userScans.map((item) => item._id);

    const assetFilter =
      assetScope === 'latest-scan' && latestScan?._id
        ? { scanId: latestScan._id }
        : { scanId: { $in: userScanIds } };

    const assets = userScanIds.length ? await Asset.find(assetFilter).lean() : [];

    const aiExecutiveSummary = await generateAiSummary({
      title: `Generated Report: ${reportType}`,
      facts: [
        `Report type: ${reportType}`,
        `Format: ${normalizedFormat}`,
        `Assets included: ${assets.length}`,
        `Charts included: ${includeCharts ? 'yes' : 'no'}`,
        `Password protected: ${passwordProtect ? 'yes' : 'no'}`,
      ],
      fallback:
        `This ${reportType} report was generated for ${assets.length} assets in ${normalizedFormat.toUpperCase()} format. ` +
        `Use it to review current risk exposure and prioritize next remediation actions.`,
    });

    const report = await GeneratedReport.create({
      generatedBy: userId,
      scanId: latestScan?._id || null,
      reportType,
      format: normalizedFormat,
      includedSections: [reportType],
      storagePath: normalizedDelivery.savePath || '',
      deliveryStatus: normalizedDelivery.email?.length ? 'queued-for-delivery' : 'generated',
      aiExecutiveSummary,
      metadata: {
        includeCharts,
        passwordProtect,
        reportPassword: passwordProtect ? trimmedReportPassword : '',
        assetScope,
        delivery: normalizedDelivery,
      },
    });

    let storagePath = report.storagePath || '';
    let deliveryStatus = report.deliveryStatus || 'generated';

    const attachment = await buildGeneratedAttachment(report, assets, {
      passwordProtect: Boolean(passwordProtect),
      reportPassword: trimmedReportPassword,
      scan: latestScan,
      userId,
    });

    if (normalizedDelivery.savePath) {
      try {
        storagePath = await persistGeneratedAttachment(normalizedDelivery.savePath, attachment);
      } catch (saveError) {
        await GeneratedReport.findByIdAndUpdate(report._id, {
          deliveryStatus: 'save-failed',
        }).lean();

        return res.status(400).json({
          message:
            `${saveError.message}. Please enter a correct writable local path and try again.`,
        });
      }
    }

    if (normalizedDelivery.email?.length) {
      try {
        const sent = await sendOnDemandEmail({
          recipients: normalizedDelivery.email,
          report,
          attachment,
        });
        deliveryStatus = sent ? 'sent' : 'delivery-pending-config';
      } catch {
        deliveryStatus = 'delivery-failed';
      }
    }

    const finalReport = await GeneratedReport.findByIdAndUpdate(
      report._id,
      {
        storagePath,
        deliveryStatus,
      },
      { new: true }
    ).lean();

    res.json({
      message: 'Report generated successfully',
      report: finalReport,
      downloadUrl: `/api/reporting/generated/${report._id}/download`,
    });
  } catch (error) {
    next(error);
  }
}

export async function createReportSchedule(req, res, next) {
  try {
    const userId = getUserId(req);
    const firstRunAt = computeFirstRunAt(req.body.nextRunAt, req.body.frequency);

    if (!firstRunAt) {
      return res.status(400).json({ message: 'Invalid schedule time provided.' });
    }

    const schedule = await ReportSchedule.create({
      userId,
      name: req.body.name,
      reportType: req.body.reportType,
      frequency: req.body.frequency,
      assetFilter: req.body.assetFilter || 'all',
      includedSections: req.body.includedSections || [],
      delivery: normalizeDelivery(req.body.delivery),
      timezone: req.body.timezone || 'Asia/Kolkata',
      nextRunAt: firstRunAt,
      isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
    });

    res.status(201).json({
      message: 'Schedule created successfully',
      schedule,
    });
  } catch (error) {
    next(error);
  }
}

export async function listReportSchedules(req, res, next) {
  try {
    const userId = getUserId(req);
    const schedules = await ReportSchedule.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ schedules });
  } catch (error) {
    next(error);
  }
}

export async function updateReportSchedule(req, res, next) {
  try {
    const userId = getUserId(req);
    const existingSchedule = await ReportSchedule.findOne({ _id: req.params.id, userId }).lean();

    if (!existingSchedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    const update = { ...req.body };

    if (Object.prototype.hasOwnProperty.call(update, 'delivery')) {
      update.delivery = normalizeDelivery(update.delivery);
    }

    if (Object.prototype.hasOwnProperty.call(update, 'nextRunAt')) {
      const frequency = update.frequency || existingSchedule.frequency;
      const computed = computeFirstRunAt(update.nextRunAt, frequency);
      if (!computed) {
        return res.status(400).json({ message: 'Invalid schedule time provided.' });
      }
      update.nextRunAt = computed;
    }

    const schedule = await ReportSchedule.findOneAndUpdate(
      { _id: req.params.id, userId },
      update,
      { new: true }
    ).lean();

    res.json({
      message: 'Schedule updated successfully',
      schedule,
    });
  } catch (error) {
    next(error);
  }
}

export async function listGeneratedReports(req, res, next) {
  try {
    const userId = getUserId(req);
    const reports = await GeneratedReport.find({ generatedBy: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ reports });
  } catch (error) {
    next(error);
  }
}

export async function downloadGeneratedReport(req, res, next) {
  try {
    const userId = getUserId(req);
    const report = await GeneratedReport.findOne({
      _id: req.params.id,
      generatedBy: userId,
    }).lean();

    if (!report) {
      return res.status(404).json({ message: 'Generated report not found' });
    }

    const assetFilter =
      report.metadata?.assetScope === 'latest-scan' && report.scanId
        ? { scanId: report.scanId }
        : {};

    const userScans = await Scan.find({ userId }).select('_id').lean();
    const userScanIds = userScans.map((item) => item._id);

    const scopedAssetFilter =
      report.metadata?.assetScope === 'latest-scan' && report.scanId
        ? { scanId: report.scanId }
        : { scanId: { $in: userScanIds } };

    const [scan, assets] = await Promise.all([
      report.scanId ? Scan.findOne({ _id: report.scanId, userId }).lean() : null,
      userScanIds.length ? Asset.find(scopedAssetFilter).lean() : [],
    ]);

    const attachment = await buildGeneratedAttachment(report, assets, {
      scan,
      userId,
      passwordProtect: Boolean(report.metadata?.passwordProtect),
      reportPassword: String(report.metadata?.reportPassword || '').trim(),
    });

    res.setHeader('Content-Type', attachment.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
    return res.send(attachment.content);
  } catch (error) {
    next(error);
  }
}

export async function deleteReportSchedule(req, res, next) {
  try {
    const userId = getUserId(req);

    const schedule = await ReportSchedule.findOneAndDelete({
      _id: req.params.id,
      userId,
    }).lean();

    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    res.json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    next(error);
  }
}