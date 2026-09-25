// Generic print-preview HTML builder for the Reports module — A4 layout with
// bordered frame, even margins, and structured sections (header / filters /
// table / signatures / footer).

import { fmtDate, fmtDateTime, fmtINR } from "@/lib/format";

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCell(column, row) {
  if (column.format === 'checkbox') {
    return '<span class="chk"></span>';
  }
  const raw = column.exportValue ? column.exportValue(row) : row[column.key];
  if (raw == null || raw === '') return '—';
  if (column.format === 'currency') return fmtINR(raw);
  if (column.format === 'weight') return `${Number(raw).toFixed(3)} g`;
  if (column.format === 'date') return escapeHtml(fmtDate(raw));
  if (column.format === 'datetime') return escapeHtml(fmtDateTime(raw));
  return escapeHtml(raw);
}

function formatClosingCell(column, row) {
  return formatCell(column, row);
}

function closingTableHtml(table, escapeHtmlFn) {
  const cols = table.columns || [];
  const rows = table.rows || [];
  const head = cols.map((c) => (
    `<th class="${c.align === 'right' ? 'num' : ''}">${escapeHtmlFn(c.label || '')}</th>`
  )).join('');
  const body = rows.map((row, i) => `
    <tr class="${i % 2 === 1 ? 'alt' : ''}">
      ${cols.map((c) => `<td class="${c.align === 'right' ? 'num' : ''}">${formatClosingCell(c, row)}</td>`).join('')}
    </tr>`).join('');
  const totals = table.totals;
  const totalsHtml = totals ? `
    <tr class="totals-row">
      ${cols.map((c) => `<td class="${c.align === 'right' ? 'num' : ''} bold">${
        totals[c.key] != null && totals[c.key] !== '' ? formatClosingCell(c, totals) : escapeHtmlFn(totals[c.key] == null ? '' : String(totals[c.key] || ''))
      }</td>`).join('')}
    </tr>` : '';
  return `
    <div class="closing-block">
      ${table.title ? `<div class="closing-title">${escapeHtmlFn(table.title)}</div>` : ''}
      <table class="data-table closing-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr class="empty-row"><td colspan="${cols.length}">No totals</td></tr>`}</tbody>
        ${totalsHtml ? `<tfoot>${totalsHtml}</tfoot>` : ''}
      </table>
    </div>`;
}

export function particularsSummaryTable(entries) {
  return {
    title: 'Total:',
    columns: [
      { key: 'particular', label: 'Particular' },
      { key: 'total', label: 'Total', format: 'currency', align: 'right' },
    ],
    rows: (entries || []).map((e) => ({
      particular: e.particular,
      total: e.total,
    })),
  };
}

export function buildReportPrintHTML({
  title,
  columns,
  rows,
  totals = null,
  company = {},
  options = {},
  filtersSummary = '',
  orientation = 'portrait',
  paperSize = 'A4',
  summaryParticulars = null,
  closingTables = [],
}) {
  const {
    showTotals = true,
    showGeneratedDate = true,
    showLogo = true,
    showSignature = true,
  } = options;

  const printCols = columns.filter((c) => !c.printHide);
  const colCount = printCols.length + 1;
  const widthHint = (c) => {
    if (c.printWidth) return `width:${c.printWidth}`;
    return '';
  };
  const headCells = printCols.map((c) => (
    `<th class="${c.align === 'right' ? 'num' : ''} ${c.format === 'checkbox' ? 'c' : ''}" style="${widthHint(c)}">${escapeHtml(c.label || '')}</th>`
  )).join('');
  const colgroup = `<colgroup><col style="width:36px" />${printCols.map((c) => `<col style="${widthHint(c)}" />`).join('')}</colgroup>`;

  const bodyRows = rows.map((row, i) => `
    <tr class="${i % 2 === 1 ? 'alt' : ''}">
      <td class="c sno">${i + 1}</td>
      ${printCols.map((c) => `<td class="${c.align === 'right' ? 'num' : ''} ${c.format === 'checkbox' ? 'c' : ''}">${formatCell(c, row)}</td>`).join('')}
    </tr>`).join('');

  const totalsRowHtml = showTotals && totals ? `
    <tr class="totals-row">
      <td class="bold">TOTAL</td>
      ${printCols.map((c) => `<td class="${c.align === 'right' ? 'num' : ''} bold">${totals[c.key] != null ? formatCell(c, totals) : ''}</td>`).join('')}
    </tr>` : '';

  const generatedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const isLandscape = String(orientation).toLowerCase() === 'landscape';
  const pageSizeName = String(paperSize || 'A4').toUpperCase() === 'LEGAL' ? 'Legal' : 'A4';
  const pageWidth = pageSizeName === 'Legal'
    ? (isLandscape ? '356mm' : '216mm')
    : (isLandscape ? '297mm' : '210mm');
  const pageHeight = pageSizeName === 'Legal'
    ? (isLandscape ? '216mm' : '356mm')
    : (isLandscape ? '210mm' : '297mm');

  const shopName = escapeHtml(company?.name || 'Jewellery Showroom');
  const recordLabel = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
  const extraClosing = [
    ...(summaryParticulars?.length ? [particularsSummaryTable(summaryParticulars)] : []),
    ...(closingTables || []),
  ];
  const closingHtml = extraClosing.length
    ? `<div class="closing-tables">${extraClosing.map((t) => closingTableHtml(t, escapeHtml)).join('')}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  width: 100%;
  background: #fff;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 9.5pt;
  color: #111;
  line-height: 1.35;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

@page {
  size: ${pageSizeName} ${isLandscape ? 'landscape' : 'portrait'};
  margin: 12mm;
}

.page {
  width: ${pageWidth};
  min-height: ${pageHeight};
  max-width: 100%;
  margin: 0 auto;
  padding: 12mm;
  background: #fff;
}

.frame {
  border: 1.5px solid #000;
  padding: 8mm 10mm 10mm;
  min-height: calc(${pageHeight} - 24mm);
}

/* ── Header ── */
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1.5px solid #000;
}
.header-left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.logo {
  height: 52px;
  width: 52px;
  object-fit: contain;
  flex-shrink: 0;
}
.shop-name {
  font-size: 14pt;
  font-weight: bold;
  letter-spacing: 0.02em;
  line-height: 1.2;
}
.shop-sub {
  font-size: 8pt;
  color: #333;
  margin-top: 2px;
  line-height: 1.45;
}
.header-right {
  text-align: right;
  flex-shrink: 0;
  font-size: 8pt;
  color: #333;
  line-height: 1.5;
}
.header-right .label {
  font-size: 7pt;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #666;
}

/* ── Title band ── */
.title-band {
  text-align: center;
  padding: 7px 8px 9px;
  margin-bottom: 10px;
  border-bottom: 1px solid #ccc;
}
.title-band .report-title {
  font-size: 12pt;
  font-weight: bold;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.title-band .report-meta {
  margin-top: 4px;
  font-size: 8pt;
  color: #555;
}

/* ── Filters ── */
.filters-box {
  border: 1px solid #bbb;
  background: #f7f7f7;
  padding: 6px 10px;
  margin-bottom: 10px;
  font-size: 8.5pt;
  color: #333;
  line-height: 1.45;
}
.filters-box .filters-label {
  font-size: 7pt;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #666;
  margin-bottom: 2px;
}

/* ── Table ── */
.table-wrap {
  margin-bottom: 12px;
  overflow: hidden;
}
table.data-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1px solid #000;
}
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr { page-break-inside: avoid; }
table.data-table th {
  background: #1a1a1a;
  color: #fff;
  padding: 5px 4px;
  font-size: 7.5pt;
  font-weight: bold;
  text-align: left;
  border: 1px solid #000;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.25;
  vertical-align: top;
  hyphens: auto;
}
table.data-table td {
  padding: 5px 4px;
  font-size: 8.5pt;
  border: 1px solid #ccc;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  word-wrap: break-word;
  line-height: 1.3;
}
table.data-table tbody tr.alt td { background: #fafafa; }
table.data-table td.num,
table.data-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
table.data-table td.c,
table.data-table th.c { text-align: center; }
table.data-table td.sno,
table.data-table th.sno { width: 36px; text-align: center; }
table.data-table td.bold,
table.data-table .bold { font-weight: bold; }
.chk {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 1px solid #111;
  vertical-align: middle;
}
table.data-table tfoot .totals-row td {
  background: #efefef;
  border-top: 2px solid #000;
  border-bottom: 2px solid #000;
  font-weight: bold;
  padding: 6px 5px;
}
.empty-row td {
  text-align: center;
  color: #888;
  padding: 18px 8px;
  font-style: italic;
}
.closing-tables {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 14px;
  align-items: flex-start;
}
.closing-block {
  margin-top: 14px;
  page-break-inside: avoid;
  break-inside: avoid;
  flex: 1 1 240px;
  min-width: 220px;
}
.closing-tables .closing-block {
  margin-top: 0;
}
.closing-title {
  font-size: 10pt;
  font-weight: bold;
  margin-bottom: 6px;
}
.closing-table {
  max-width: 100%;
}

/* ── Signatures ── */
.sign {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid #ccc;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  page-break-inside: avoid;
}
.sign-block {
  flex: 1;
  text-align: center;
  font-size: 8.5pt;
  color: #333;
}
.sign-block .line {
  margin: 0 auto;
  margin-top: 32px;
  width: 85%;
  max-width: 140px;
  border-top: 1px solid #333;
  padding-top: 5px;
}

/* ── Footer ── */
.footer {
  margin-top: 14px;
  padding-top: 8px;
  border-top: 1px solid #bbb;
  font-size: 7.5pt;
  color: #666;
  text-align: center;
  letter-spacing: 0.02em;
}

@media print {
  html, body { background: #fff; }
  .page {
    width: auto;
    min-height: auto;
    max-width: none;
    margin: 0;
    padding: 0;
  }
  .frame {
    min-height: auto;
    border: 1.5px solid #000;
    padding: 7mm 9mm 9mm;
  }
}
</style>
</head>
<body>
<div class="page">
  <div class="frame">

    <div class="header">
      <div class="header-left">
        ${showLogo && company?.logo ? `<img class="logo" src="${company.logo}" alt="" />` : ''}
        <div>
          <div class="shop-name">${shopName}</div>
          ${company?.address ? `<div class="shop-sub">${escapeHtml(company.address)}</div>` : ''}
          ${company?.phone ? `<div class="shop-sub">Tel: ${escapeHtml(company.phone)}</div>` : ''}
          ${company?.gst_number ? `<div class="shop-sub">GSTIN: ${escapeHtml(company.gst_number)}</div>` : ''}
        </div>
      </div>
      <div class="header-right">
        ${showGeneratedDate ? `<div><span class="label">Generated</span><br/>${generatedAt}</div>` : ''}
        <div style="margin-top:${showGeneratedDate ? '6px' : '0'}"><span class="label">Records</span><br/>${recordLabel}</div>
      </div>
    </div>

    <div class="title-band">
      <div class="report-title">${escapeHtml(title)}</div>
    </div>

    ${filtersSummary ? `
    <div class="filters-box">
      <div class="filters-label">Filters Applied</div>
      ${escapeHtml(filtersSummary)}
    </div>` : ''}

    <div class="table-wrap">
      <table class="data-table">
        ${colgroup}
        <thead>
          <tr>
            <th class="c sno">S.No</th>
            ${headCells}
          </tr>
        </thead>
        <tbody>
          ${bodyRows || `<tr class="empty-row"><td colspan="${colCount}">No data available for the selected filters</td></tr>`}
          ${totalsRowHtml}
        </tbody>
      </table>
    </div>

    ${closingHtml}

    ${showSignature ? `
    <div class="sign">
      <div class="sign-block"><div class="line">Verified By</div></div>
      <div class="sign-block"><div class="line">Checked By</div></div>
      <div class="sign-block"><div class="line">Approved By</div></div>
    </div>` : ''}

    <div class="footer">${shopName} — Confidential Report — ${recordLabel}</div>

  </div>
</div>
</body>
</html>`;
}
