import { jsPDF } from 'jspdf';

function safe(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safe(value);
  return date.toLocaleString();
}

function buildFilename(scan = {}) {
  const id = safe(scan._id, 'scan').replace(/[^a-zA-Z0-9_-]/g, '');
  return `cbom-${id}.pdf`;
}

export function downloadCbomPdf(scan = {}, cbom = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 44;
  const marginY = 42;
  const contentWidth = pageWidth - marginX * 2;
  let y = marginY;

  const ensureSpace = (required = 24) => {
    if (y + required <= pageHeight - marginY) return;
    doc.addPage();
    y = marginY;
  };

  const drawSectionTitle = (title) => {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(26, 64, 86);
    doc.text(title, marginX, y);
    y += 10;

    doc.setDrawColor(193, 212, 224);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 14;
  };

  const drawParagraph = (text) => {
    const lines = doc.splitTextToSize(safe(text), contentWidth);
    ensureSpace(lines.length * 14 + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(55, 72, 84);
    doc.text(lines, marginX, y);
    y += lines.length * 14 + 8;
  };

  const drawKeyValueGrid = (pairs = []) => {
    const col1X = marginX;
    const col2X = marginX + contentWidth / 2 + 10;
    const colWidth = contentWidth / 2 - 10;
    const left = pairs.filter((_, index) => index % 2 === 0);
    const right = pairs.filter((_, index) => index % 2 === 1);
    const maxRows = Math.max(left.length, right.length);

    for (let i = 0; i < maxRows; i += 1) {
      ensureSpace(28);

      const leftRow = left[i];
      const rightRow = right[i];

      if (leftRow) {
        const [label, value] = leftRow;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(94, 118, 136);
        doc.text(String(label).toUpperCase(), col1X, y);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        doc.setTextColor(38, 56, 68);
        const leftText = doc.splitTextToSize(safe(value), colWidth);
        doc.text(leftText, col1X, y + 13);
      }

      if (rightRow) {
        const [label, value] = rightRow;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(94, 118, 136);
        doc.text(String(label).toUpperCase(), col2X, y);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        doc.setTextColor(38, 56, 68);
        const rightText = doc.splitTextToSize(safe(value), colWidth);
        doc.text(rightText, col2X, y + 13);
      }

      y += 34;
    }

    y += 6;
  };

  const drawBullets = (items = [], emptyText) => {
    if (!items.length) {
      drawParagraph(emptyText);
      return;
    }

    items.forEach((item) => {
      const line = `• ${safe(item)}`;
      const wrapped = doc.splitTextToSize(line, contentWidth);
      ensureSpace(wrapped.length * 14 + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(55, 72, 84);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 14 + 3;
    });

    y += 3;
  };

  const drawAssetBlock = (asset, index) => {
    const title = `${index + 1}. ${safe(asset.asset_type || asset.assetType || 'asset')} — ${safe(asset.target || asset.name)}`;
    const fields = [
      ['TLS Version', safe(asset.tls_version || asset.tlsVersion)],
      ['Cipher', safe(asset.cipher)],
      ['Key Exchange', safe(asset.key_exchange || asset.keyExchange)],
      ['Signature', safe(asset.signature)],
      ['Issuer', safe(asset.issuer)],
      ['Quantum Safe', asset.quantum_safe === true || asset.quantumSafe === true ? 'Yes' : asset.quantum_safe === false || asset.quantumSafe === false ? 'No' : 'Unknown'],
    ];

    const approxHeight = 24 + fields.length * 16;
    ensureSpace(approxHeight);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(24, 62, 84);
    doc.text(title, marginX, y);
    y += 14;

    fields.forEach(([label, value]) => {
      const text = `${label}: ${value}`;
      const wrapped = doc.splitTextToSize(text, contentWidth - 10);
      ensureSpace(wrapped.length * 13 + 2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.8);
      doc.setTextColor(58, 77, 92);
      doc.text(wrapped, marginX + 8, y);
      y += wrapped.length * 13 + 2;
    });

    y += 5;
  };

  doc.setFillColor(37, 113, 130);
  doc.rect(0, 0, pageWidth, 84, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text('CBOM Report', marginX, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(228, 240, 245);
  doc.text(`Generated ${new Date().toLocaleString()}`, marginX, 67);

  y = 104;

  drawSectionTitle('Scan Overview');
  drawKeyValueGrid([
    ['Scan ID', safe(scan._id)],
    ['Target', safe(scan.domain || scan.apiEndpoint || scan.target || scan.name)],
    ['Security Score', `${Number(scan.overallRiskScore || 0)}/100`],
    ['Risk Level', safe(scan.riskLevel)],
    ['Created At', formatDate(scan.createdAt)],
    ['Status', safe(scan.status, 'completed')],
  ]);

  drawSectionTitle('Summary');
  drawParagraph(scan.summary || 'No scan summary available.');

  drawSectionTitle('Findings');
  drawBullets(Array.isArray(scan.findings) ? scan.findings : [], 'No findings for this scan.');

  drawSectionTitle('Warnings');
  drawBullets(Array.isArray(scan.warnings) ? scan.warnings : [], 'No warnings for this scan.');

  drawSectionTitle('CBOM Assets');
  const cbomAssets = Array.isArray(cbom.assets) ? cbom.assets : [];

  if (!cbomAssets.length) {
    drawParagraph('No CBOM assets available in this scan output.');
  } else {
    cbomAssets.forEach((asset, index) => drawAssetBlock(asset, index));
  }

  drawSectionTitle('Raw CBOM JSON Snapshot');
  const rawText = JSON.stringify(cbom || {}, null, 2);
  const rawLines = doc.splitTextToSize(rawText, contentWidth);

  doc.setFont('courier', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(58, 77, 92);

  rawLines.forEach((line) => {
    ensureSpace(11);
    doc.text(line, marginX, y);
    y += 10.5;
  });

  doc.save(buildFilename(scan));
}
