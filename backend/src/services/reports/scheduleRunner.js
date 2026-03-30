import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import ReportSchedule from '../../models/ReportSchedule.js';
import GeneratedReport from '../../models/GeneratedReport.js';
import { Scan } from '../../models/Scan.js';
import { Asset } from '../../models/Asset.js';
import { generateAiSummary } from '../ai/dashboardAiService.js';
import { env } from '../../config/env.js';
import { assetDisplayName, derivePqc, deriveSeverity } from '../../utils/securityDerivation.js';

const RUN_INTERVAL_MS = 60 * 1000;
let runnerTimer = null;
let isRunning = false;
let transporter = null;

const palette = {
  brand: '#0B3558',
  accent: '#00A3A3',
  ink: '#1D2939',
  muted: '#667085',
  tileBg: '#F5FAFF',
  border: '#D8E4EE',
};

function hasSmtpConfig() {
  return Boolean(env.smtpHost && env.smtpPort && env.smtpFrom && env.smtpUser && env.smtpPass);
}

function getTransporter() {
  if (!hasSmtpConfig()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });

  return transporter;
}

function normalizeEmailList(input) {
  const raw = Array.isArray(input) ? input : [input];

  return raw
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function nextRunDate(baseDate, frequency) {
  const next = new Date(baseDate);

  if (frequency === 'daily') next.setDate(next.getDate() + 1);
  else if (frequency === 'weekly') next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);

  return next;
}

function computeNextRunAfterNow(schedule) {
  const baseline = new Date();
  const next = nextRunDate(baseline, schedule.frequency);
  return next;
}

function jsonToCsvRow(values) {
  return values
    .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
    .join(',');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function bestAssetTarget(asset = {}) {
  return asset.target || asset.url || asset.domain || asset.hostname || asset.ipAddress || asset.name || '';
}

function ensureSpace(doc, minHeight = 70) {
  if (doc.y > doc.page.height - minHeight) {
    doc.addPage();
    doc
      .save()
      .fillColor('#FCFEFF')
      .rect(0, 0, doc.page.width, doc.page.height)
      .fill()
      .restore();
    doc.y = 46;
  }
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 84);
  doc.moveDown(0.5);
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc
    .save()
    .roundedRect(x, y, width, 30, 9)
    .fillAndStroke('#EFF8FF', palette.border)
    .restore();
  doc.save().roundedRect(x + 8, y + 8, 14, 14, 4).fill(palette.accent).restore();
  doc.fillColor(palette.brand).font('Helvetica-Bold').fontSize(13).text(title, x + 30, y + 8);
  doc.y = y + 35;
}

function bullet(doc, text) {
  ensureSpace(doc, 28);
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.save().fillColor(palette.accent).circle(x + 4, y + 7, 2.5).fill().restore();
  doc.fillColor(palette.ink).font('Helvetica').fontSize(10.5).text(text, x + 14, y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14,
  });
}

function metricLine(doc, label, value) {
  ensureSpace(doc, 34);
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc
    .save()
    .roundedRect(x, y, width, 22, 6)
    .fillAndStroke('#FFFFFF', '#EDF2F7')
    .restore();
  doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(10).text(label, x + 10, y + 6);
  doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(10).text(String(value), x + width - 170, y + 6, {
    width: 160,
    align: 'right',
  });
  doc.y = y + 26;
}

function drawHero(doc, report, sections, assetsCount) {
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const h = 118;

  doc.save().roundedRect(x, y, width, h, 14).fill('#0B3558').restore();
  doc.save().fillColor('#0E456E').circle(x + width - 48, y + 24, 32).fill().fillColor('#16608F').circle(x + width - 20, y + 80, 22).fill().restore();

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(21).text('Quantum Scanner', x + 16, y + 18);
  doc.fillColor('#E4F6FF').font('Helvetica').fontSize(12).text('Scheduled Security Report', x + 16, y + 45);
  doc.fillColor('#C9E8F6').font('Helvetica').fontSize(10)
    .text(`Type: ${report.reportType || '-'}`, x + 16, y + 66)
    .text(`Generated: ${new Date(report.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, x + 16, y + 80)
    .text(`Assets: ${assetsCount}  |  Risk Score: ${sections.scan ? sections.scan.riskScore.toFixed(1) : '0.0'} / 100`, x + 16, y + 94);

  doc.y = y + h + 12;
}

function buildSections(assets = [], scan = null) {
  const byType = new Map();
  const byStatus = new Map();
  const byPqc = new Map();
  const byProtocol = new Map();
  const hosts = new Set();

  let weakProtocols = 0;
  let weakCiphers = 0;
  let cryptoAssets = 0;
  const riskyAssets = [];

  for (const asset of assets) {
    const type = normalize(asset.assetType || asset.type || 'unknown') || 'unknown';
    const status = normalize(asset.status) || 'unknown';
    const severity = deriveSeverity(asset);
    const protocol = normalize(asset.tlsVersion || asset.protocol || asset.metadata?.tlsVersion) || 'unknown';
    const cipher = normalize(asset.cipherSuite || asset.cipher || asset.metadata?.cipherSuite || asset.metadata?.cipher);
    const pqc = derivePqc(asset) || {};
    const support = normalize(pqc.supportStatus) || 'unknown';

    byType.set(type, (byType.get(type) || 0) + 1);
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    byPqc.set(support, (byPqc.get(support) || 0) + 1);
    byProtocol.set(protocol, (byProtocol.get(protocol) || 0) + 1);

    const host = String(asset.hostname || asset.domain || '').trim().toLowerCase();
    if (host) hosts.add(host);

    if (asset.tlsVersion || asset.protocol || asset.cipherSuite || asset.cipher || asset.keyLength || asset.certificateAuthority) {
      cryptoAssets += 1;
    }

    if (protocol.includes('ssl') || protocol.includes('1.0') || protocol.includes('1.1')) {
      weakProtocols += 1;
    }

    if (['3des', 'rc4', 'des', 'md5', 'sha1', 'cbc'].some((item) => cipher.includes(item))) {
      weakCiphers += 1;
    }

    if (severity === 'critical' || severity === 'high') {
      riskyAssets.push({
        name: assetDisplayName(asset),
        type,
        severity,
        status,
        target: bestAssetTarget(asset),
      });
    }
  }

  const toList = (map, limit = 8) =>
    [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);

  return {
    scan: scan
      ? {
          id: String(scan._id || ''),
          riskScore: Number(scan.overallRiskScore || 0),
          riskLevel: scan.riskLevel || '-',
        }
      : null,
    totals: {
      assets: assets.length,
      cryptoAssets,
      weakProtocols,
      weakCiphers,
      discoveredHosts: hosts.size,
    },
    inventory: {
      byType: toList(byType),
      byStatus: toList(byStatus),
    },
    cbom: {
      byProtocol: toList(byProtocol),
      weakProtocols,
      weakCiphers,
    },
    pqc: {
      bySupport: toList(byPqc),
    },
    risk: {
      topRiskyAssets: riskyAssets.slice(0, 20),
    },
    assets: assets.slice(0, 1000).map((asset) => ({
      name: assetDisplayName(asset),
      type: normalize(asset.assetType || asset.type || 'unknown') || 'unknown',
      severity: deriveSeverity(asset),
      status: normalize(asset.status) || 'unknown',
      target: bestAssetTarget(asset),
      host: asset.hostname || asset.domain || '',
      ipAddress: asset.ipAddress || '',
      tlsVersion: asset.tlsVersion || asset.protocol || '',
      cipherSuite: asset.cipherSuite || asset.cipher || '',
      keyLength: asset.keyLength || '',
      certificateAuthority: asset.certificateAuthority || asset.issuer || '',
      pqcSupport: derivePqc(asset)?.supportStatus || '',
      pqcGrade: derivePqc(asset)?.grade || '',
      migrationPriority: derivePqc(asset)?.migrationPriority || '',
    })),
  };
}

async function buildPdfBuffer(report, assets, scan = null) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sections = buildSections(assets, scan);
    const doc = new PDFDocument({ margin: 48 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    drawHero(doc, report, sections, assets.length);

    sectionTitle(doc, 'Report Context');
    metricLine(doc, 'Report Type', report.reportType || '-');
    metricLine(doc, 'Format', String(report.format || 'pdf').toUpperCase());
    metricLine(doc, 'Assets in Scope', assets.length);
    metricLine(doc, 'Risk Level', sections.scan?.riskLevel || '-');

    sectionTitle(doc, 'Executive Summary');
    doc.fontSize(11).fillColor(palette.ink).text(
      report.aiExecutiveSummary ||
        'No summary was generated for this report. Please review latest risk and configuration details from the dashboard.'
    );

    const reportType = normalize(report.reportType);

    if (reportType === 'asset-discovery') {
      sectionTitle(doc, 'Discovery Coverage');
      metricLine(doc, 'Discovered Hosts', sections.totals.discoveredHosts);
      sections.inventory.byType.slice(0, 8).forEach((item) => {
        bullet(doc, `Type ${item.label}: ${item.value}`);
      });
      sectionTitle(doc, 'Discovery Assets (Top 30)');
      sections.assets.slice(0, 30).forEach((asset, index) => {
        bullet(doc, `${index + 1}. ${asset.name} | ${asset.type} | Host: ${asset.host || '-'} | Target: ${asset.target || '-'}`);
      });
    } else if (reportType === 'asset-inventory') {
      sectionTitle(doc, 'Inventory Summary');
      sections.inventory.byType.slice(0, 8).forEach((item) => {
        bullet(doc, `Type ${item.label}: ${item.value}`);
      });
      sections.inventory.byStatus.slice(0, 8).forEach((item) => {
        bullet(doc, `Status ${item.label}: ${item.value}`);
      });
      sectionTitle(doc, 'Inventory Assets (Top 40)');
      sections.assets.slice(0, 40).forEach((asset, index) => {
        bullet(doc, `${index + 1}. ${asset.name} | ${asset.type} | ${asset.status} | ${asset.target || '-'}`);
      });
    } else if (reportType === 'cbom') {
      sectionTitle(doc, 'CBOM Snapshot');
      metricLine(doc, 'Crypto Assets', sections.totals.cryptoAssets);
      metricLine(doc, 'Weak Protocol Findings', sections.cbom.weakProtocols);
      metricLine(doc, 'Weak Cipher Findings', sections.cbom.weakCiphers);
      sections.cbom.byProtocol.slice(0, 8).forEach((item) => {
        bullet(doc, `Protocol ${item.label}: ${item.value}`);
      });
    } else if (reportType === 'pqc-posture') {
      sectionTitle(doc, 'PQC Snapshot');
      sections.pqc.bySupport.slice(0, 8).forEach((item) => {
        bullet(doc, `Support ${item.label}: ${item.value}`);
      });
      sectionTitle(doc, 'PQC Assets Requiring Action');
      sections.assets
        .filter((asset) => ['critical', 'legacy'].includes(String(asset.pqcGrade || '').toLowerCase()))
        .slice(0, 30)
        .forEach((asset, index) => {
          bullet(doc, `${index + 1}. ${asset.name} | Grade: ${asset.pqcGrade || '-'} | Support: ${asset.pqcSupport || '-'} | Priority: ${asset.migrationPriority || '-'}`);
        });
    } else if (reportType === 'cyber-rating') {
      sectionTitle(doc, 'Cyber Rating Snapshot');
      metricLine(doc, 'Weak Protocol Findings', sections.totals.weakProtocols);
      metricLine(doc, 'Weak Cipher Findings', sections.totals.weakCiphers);
      metricLine(doc, 'Discovered Hosts', sections.totals.discoveredHosts);
      sectionTitle(doc, 'Top At-Risk Assets');
      sections.risk.topRiskyAssets.slice(0, 25).forEach((asset, index) => {
        bullet(doc, `${index + 1}. ${asset.name || `Asset ${index + 1}`} | Type: ${asset.type || '-'} | Severity: ${asset.severity || '-'} | Status: ${asset.status || '-'}`);
      });
    } else {
      sectionTitle(doc, 'Risk and Action Snapshot');
      metricLine(doc, 'Weak Protocol Findings', sections.totals.weakProtocols);
      metricLine(doc, 'Weak Cipher Findings', sections.totals.weakCiphers);
      metricLine(doc, 'Crypto Assets', sections.totals.cryptoAssets);
      sectionTitle(doc, 'Top At-Risk Assets (Top 20)');
      const topAssets = sections.risk.topRiskyAssets;
      if (!topAssets.length) {
        bullet(doc, 'No assets available for this schedule scope.');
      } else {
        topAssets.forEach((asset, index) => {
          bullet(doc, `${index + 1}. ${asset.name || `Asset ${index + 1}`} | Type: ${asset.type || '-'} | Severity: ${asset.severity || '-'} | Status: ${asset.status || '-'}`);
        });
      }
    }

    doc.end();
  });
}

async function buildAttachment(report, assets, scan = null) {
  const requestedFormat = String(report.format || 'pdf').toLowerCase();
  const safeType = String(report.reportType || 'report').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const baseName = `${safeType}-${report._id}`;
  const sections = buildSections(assets, scan);

  if (requestedFormat === 'json') {
    const payload = {
      report: {
        id: String(report._id || ''),
        reportType: report.reportType,
        format: report.format,
        generatedAt: report.createdAt,
      },
      generatedAt: report.createdAt,
      assetsCount: assets.length,
      executiveSummary: report.aiExecutiveSummary || '',
      sections,
    };

    return {
      filename: `${baseName}.json`,
      contentType: 'application/json',
      content: Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'),
    };
  }

  if (requestedFormat === 'csv') {
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

    const rows = [];
    const pushMetric = (section, metric, value) => {
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
          '',
        ])
      );
    };

    const pushAsset = (section, asset = {}) => {
      rows.push(
        jsonToCsvRow([
          section,
          'asset',
          asset.name || '',
          asset.type || '',
          asset.severity || '',
          asset.status || '',
          asset.target || '',
          asset.host || '',
          asset.ipAddress || '',
          asset.tlsVersion || '',
          asset.cipherSuite || '',
          asset.keyLength || '',
          asset.certificateAuthority || '',
          asset.pqcSupport || '',
          asset.pqcGrade || '',
          asset.migrationPriority || '',
          '',
          '',
          '',
        ])
      );
    };

    pushMetric('report', 'report_type', report.reportType || '');
    pushMetric('report', 'generated_at', report.createdAt || '');
    pushMetric('report', 'assets_count', assets.length);
    pushMetric('cbom', 'crypto_assets', sections.totals.cryptoAssets);
    pushMetric('cbom', 'weak_protocol_findings', sections.totals.weakProtocols);
    pushMetric('cbom', 'weak_cipher_findings', sections.totals.weakCiphers);
    pushMetric('discovery', 'unique_hosts', sections.totals.discoveredHosts);

    sections.inventory.byType.forEach((item) => pushMetric('inventory', `type_${item.label}`, item.value));
    sections.inventory.byStatus.forEach((item) => pushMetric('inventory', `status_${item.label}`, item.value));
    sections.pqc.bySupport.forEach((item) => pushMetric('pqc', `support_${item.label}`, item.value));

    sections.risk.topRiskyAssets.forEach((asset) => pushAsset('risk_top_assets', asset));
    sections.assets.slice(0, 1000).forEach((asset) => pushAsset('all_assets', asset));

    const csv = [jsonToCsvRow(header), ...rows].join('\n');
    return {
      filename: `${baseName}.csv`,
      contentType: 'text/csv',
      content: Buffer.from(csv, 'utf-8'),
    };
  }

  return {
    filename: `${baseName}.pdf`,
    contentType: 'application/pdf',
    content: await buildPdfBuffer(report, assets, scan),
  };
}

async function sendScheduledReportEmail(schedule, report, assets) {
  const smtp = getTransporter();
  const recipients = normalizeEmailList(schedule.delivery?.email);

  if (!smtp || !recipients.length) {
    return false;
  }

  const attachment = await buildAttachment(report, assets, scan);

  await smtp.sendMail({
    from: env.smtpFrom,
    to: recipients.join(', '),
    envelope: {
      from: env.smtpFrom,
      to: recipients,
    },
    subject: `[Quantum Scanner] ${schedule.name || 'Scheduled Report'} - ${String(report.reportType || '').toUpperCase()}`,
    text:
      `Scheduled report generated successfully.\n\n` +
      `Report Type: ${report.reportType}\n` +
      `Frequency: ${schedule.frequency}\n` +
      `Generated: ${new Date(report.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n` +
      `Please find the report attached.`,
    attachments: [attachment],
  });

  return true;
}

async function processSingleSchedule(schedule) {
  const now = new Date();
  if (new Date(schedule.nextRunAt).getTime() > now.getTime()) {
    return;
  }

  const scan = await Scan.findOne({ userId: schedule.userId }).sort({ createdAt: -1 }).lean();

  const userScans = await Scan.find({ userId: schedule.userId }).select('_id').lean();
  const userScanIds = userScans.map((item) => item._id);

  const assetFilter =
    schedule.assetFilter === 'latest-scan' && scan?._id
      ? { scanId: scan._id }
      : { scanId: { $in: userScanIds } };

  const assets = userScanIds.length ? await Asset.find(assetFilter).lean() : [];

  const format = String(schedule.delivery?.format || 'pdf').toLowerCase();

  const aiExecutiveSummary = await generateAiSummary({
    title: `Scheduled Report: ${schedule.reportType}`,
    facts: [
      `Schedule name: ${schedule.name}`,
      `Frequency: ${schedule.frequency}`,
      `Report type: ${schedule.reportType}`,
      `Assets included: ${assets.length}`,
      `Format: ${format}`,
    ],
    fallback:
      `Scheduled ${schedule.reportType} report for ${assets.length} assets in ${String(format).toUpperCase()} format. ` +
      `Review findings and prioritize action items.`,
  });

  const report = await GeneratedReport.create({
    generatedBy: schedule.userId,
    scanId: scan?._id || null,
    reportType: schedule.reportType,
    format,
    includedSections: schedule.includedSections || [schedule.reportType],
    storagePath: schedule.delivery?.savePath || '',
    deliveryStatus: 'generated',
    aiExecutiveSummary,
    metadata: {
      source: 'schedule-runner',
      scheduleId: schedule._id,
      frequency: schedule.frequency,
      timezone: schedule.timezone,
      assetFilter: schedule.assetFilter,
      delivery: schedule.delivery,
    },
  });

  const sent = await sendScheduledReportEmail(schedule, report, assets);
  if (sent) {
    await GeneratedReport.findByIdAndUpdate(report._id, { deliveryStatus: 'sent' }).lean();
  }

  await ReportSchedule.findByIdAndUpdate(schedule._id, {
    nextRunAt: computeNextRunAfterNow(schedule),
  }).lean();
}

async function runDueSchedules() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();
    const dueSchedules = await ReportSchedule.find({
      isActive: true,
      nextRunAt: { $lte: now },
    })
      .sort({ nextRunAt: 1 })
      .limit(20)
      .lean();

    for (const schedule of dueSchedules) {
      try {
        await processSingleSchedule(schedule);
      } catch (err) {
        console.error(`[schedule-runner] Failed schedule ${schedule._id}:`, err.message);
        await ReportSchedule.findByIdAndUpdate(schedule._id, {
          nextRunAt: computeNextRunAfterNow(schedule),
        }).lean();
      }
    }
  } finally {
    isRunning = false;
  }
}

export function startReportScheduleRunner() {
  if (runnerTimer) return;

  if (!hasSmtpConfig()) {
    console.warn(
      '[schedule-runner] SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in backend/.env for email delivery.'
    );
  }

  runnerTimer = setInterval(runDueSchedules, RUN_INTERVAL_MS);
  runDueSchedules().catch((err) => {
    console.error('[schedule-runner] Initial run failed:', err.message);
  });

  console.log(`[schedule-runner] Started. Checking due schedules every ${RUN_INTERVAL_MS / 1000}s.`);
}

export function stopReportScheduleRunner() {
  if (!runnerTimer) return;
  clearInterval(runnerTimer);
  runnerTimer = null;
}
