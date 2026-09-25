// Client-side Excel/PDF/CSV generators for the Reports module. All three take the
// same {title, columns, rows, totals, options} contract every report view builds,
// so ReportViewModal can call whichever format the user picked without any
// per-report custom export code.

import { fmtDate, fmtDateTime, fmtINR } from "@/lib/format";

function formatValue(column, value) {
  if (value == null || value === '') return '';
  if (column.format === 'currency') return Number(value);
  if (column.format === 'weight') return `${Number(value).toFixed(3)} g`;
  if (column.format === 'date') return fmtDate(value);
  if (column.format === 'datetime') return fmtDateTime(value);
  return value;
}

function cellFor(column, row) {
  // exportValue (plain data) takes priority over render (which may return JSX
  // for on-screen-only controls like the Stock Check verification checkbox).
  const raw = column.exportValue ? column.exportValue(row) : row[column.key];
  return formatValue(column, raw);
}

function pdfCellFor(column, row) {
  const raw = column.exportValue ? column.exportValue(row) : row[column.key];
  if (raw == null || raw === '') return '—';
  if (column.format === 'currency') return fmtINR(raw);
  return String(formatValue(column, raw));
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportReportCsv({ title, columns, rows, totals, options = {} }) {
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => {
      const v = cellFor(c, row);
      return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : (v ?? '');
    }).join(','))
    .join('\n');
  const totalsLine = options.showTotals && totals
    ? '\n' + columns.map((c) => (totals[c.key] != null ? `"${cellFor(c, totals)}"` : '')).join(',')
    : '';
  const csv = `${header}\n${body}${totalsLine}`;
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${title.replace(/\s+/g, '-').toLowerCase()}.csv`);
}

export async function exportReportExcel({ title, columns, rows, totals, options = {}, company = {}, closingTables = [], summaryParticulars = null }) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.slice(0, 31) || 'Report');

  let rowCursor = 1;
  sheet.mergeCells(rowCursor, 1, rowCursor, columns.length);
  sheet.getCell(rowCursor, 1).value = company?.name || 'Jewellery Showroom';
  sheet.getCell(rowCursor, 1).font = { bold: true, size: 14 };
  rowCursor += 1;

  sheet.mergeCells(rowCursor, 1, rowCursor, columns.length);
  sheet.getCell(rowCursor, 1).value = title;
  sheet.getCell(rowCursor, 1).font = { bold: true, size: 12, color: { argb: 'FFB49042' } };
  rowCursor += 1;

  if (options.showGeneratedDate) {
    sheet.mergeCells(rowCursor, 1, rowCursor, columns.length);
    sheet.getCell(rowCursor, 1).value = `Generated: ${new Date().toLocaleString('en-IN')}`;
    sheet.getCell(rowCursor, 1).font = { italic: true, size: 9, color: { argb: 'FF737373' } };
    rowCursor += 1;
  }
  rowCursor += 1;

  const headerRow = sheet.getRow(rowCursor);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
    cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left' };
  });
  rowCursor += 1;

  for (const row of rows) {
    const r = sheet.getRow(rowCursor);
    columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = cellFor(c, row);
      cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left' };
      if (c.format === 'currency') cell.numFmt = '[$₹-en-IN]##,##,##0.00';
    });
    rowCursor += 1;
  }

  if (options.showTotals && totals) {
    const r = sheet.getRow(rowCursor);
    columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = totals[c.key] != null ? cellFor(c, totals) : (i === 0 ? 'TOTAL' : '');
      cell.font = { bold: true };
      cell.border = { top: { style: 'medium' } };
    });
    rowCursor += 1;
  }

  const extraClosing = [
    ...(summaryParticulars?.length ? [{
      title: 'Total:',
      columns: [
        { key: 'particular', label: 'Particular' },
        { key: 'total', label: 'Total', format: 'currency', align: 'right' },
      ],
      rows: summaryParticulars.map((e) => ({ particular: e.particular, total: e.total })),
    }] : []),
    ...(closingTables || []),
  ];
  for (const table of extraClosing) {
    rowCursor += 2;
    if (table.title) {
      sheet.mergeCells(rowCursor, 1, rowCursor, Math.max((table.columns || []).length, 1));
      sheet.getCell(rowCursor, 1).value = table.title;
      sheet.getCell(rowCursor, 1).font = { bold: true, size: 11 };
      rowCursor += 1;
    }
    const cols = table.columns || [];
    const headerRow = sheet.getRow(rowCursor);
    cols.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
    });
    rowCursor += 1;
    for (const row of table.rows || []) {
      const r = sheet.getRow(rowCursor);
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        cell.value = cellFor(c, row);
        cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left' };
        if (c.format === 'currency') cell.numFmt = '[$₹-en-IN]##,##,##0.00';
      });
      rowCursor += 1;
    }
    if (table.totals) {
      const r = sheet.getRow(rowCursor);
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        cell.value = table.totals[c.key] != null ? cellFor(c, table.totals) : (i === 0 ? 'TOTAL' : '');
        cell.font = { bold: true };
      });
      rowCursor += 1;
    }
  }

  columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = Math.max(12, (c.label || '').length + 4);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${title.replace(/\s+/g, '-').toLowerCase()}.xlsx`,
  );
}

function pdfColumnStyles(columns, pageWidth) {
  let usable = Math.max(pageWidth - 80, 200);
  if (columns.some((c) => c.key === '__sno')) usable = Math.max(usable - 32, 160);
  const explicit = columns.map((c) => {
    if (c.key === '__sno') return 32;
    if (!c.printWidth) return null;
    const raw = String(c.printWidth);
    if (raw.endsWith('%')) return (Number.parseFloat(raw) / 100) * usable;
    const pt = Number.parseFloat(raw);
    return Number.isFinite(pt) && pt > 0 ? pt : null;
  });
  const leftover = usable - explicit.filter((w, i) => columns[i].key !== '__sno').reduce((s, w) => s + (w || 0), 0);
  const unset = explicit.filter((w, i) => w == null && columns[i].key !== '__sno').length;
  const auto = unset ? Math.max(leftover / unset, 28) : 0;
  return columns.reduce((acc, c, i) => {
    acc[i] = {
      halign: c.align === 'right' || c.key === '__sno' ? 'right' : 'left',
      cellWidth: explicit[i] != null ? explicit[i] : auto,
      overflow: 'linebreak',
      valign: 'top',
    };
    return acc;
  }, {});
}

function remainingPageSpace(doc, y) {
  return doc.internal.pageSize.getHeight() - 48 - y;
}

export async function exportReportPdf({
  title, columns, rows, totals, options = {}, company = {}, orientation = 'portrait', paperSize = 'a4',
  summaryParticulars = null, closingTables = [], filtersSummary = '',
}) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const { particularsSummaryTable } = await import('@/lib/reportPrint');

  const doc = new jsPDF({ orientation, unit: 'pt', format: paperSize.toLowerCase() });
  const pageWidth = doc.internal.pageSize.getWidth();
  let cursorY = 40;

  if (options.showLogo && company?.logo) {
    try {
      doc.addImage(company.logo, 'PNG', 40, cursorY - 20, 36, 36);
    } catch { /* unsupported image format — skip logo, keep export working */ }
  }

  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text(company?.name || 'Jewellery Showroom', options.showLogo && company?.logo ? 86 : 40, cursorY);
  cursorY += 18;

  doc.setFontSize(11);
  doc.setTextColor(180, 144, 66);
  doc.text(title, options.showLogo && company?.logo ? 86 : 40, cursorY);
  doc.setTextColor(0, 0, 0);
  cursorY += 14;

  if (options.showGeneratedDate) {
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(115, 115, 115);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 40, cursorY);
    doc.setTextColor(0, 0, 0);
    cursorY += 14;
  }

  if (filtersSummary) {
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    const filterLines = doc.splitTextToSize(`Filters Applied: ${filtersSummary}`, pageWidth - 80);
    doc.text(filterLines, 40, cursorY);
    cursorY += filterLines.length * 11 + 4;
    doc.setTextColor(0, 0, 0);
  }

  const pdfCols = [{ key: '__sno', label: 'S.No', align: 'right', printWidth: '6%' }, ...columns];
  const head = [pdfCols.map((c) => c.label)];
  const body = rows.map((row, i) => pdfCols.map((c) => (c.key === '__sno' ? String(i + 1) : pdfCellFor(c, row))));
  if (options.showTotals && totals) {
    body.push(pdfCols.map((c, i) => {
      if (c.key === '__sno') return 'TOTAL';
      return totals[c.key] != null ? pdfCellFor(c, totals) : (i === 1 && totals[columns[0]?.key] == null ? '' : '');
    }));
  }

  const manyCols = columns.length >= 8;
  autoTable(doc, {
    startY: cursorY + 6,
    head,
    body,
    styles: {
      fontSize: manyCols ? 7 : 8,
      cellPadding: 3,
      overflow: 'linebreak',
      valign: 'top',
      minCellHeight: 14,
    },
    headStyles: {
      fillColor: [17, 17, 17],
      textColor: 255,
      overflow: 'linebreak',
      valign: 'top',
      fontSize: manyCols ? 7 : 8,
    },
    columnStyles: pdfColumnStyles(pdfCols, pageWidth),
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    tableWidth: pageWidth - 80,
    didParseCell: (data) => {
      if (options.showTotals && totals && data.row.index === body.length - 1 && data.section === 'body') {
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  const extraClosing = [
    ...(summaryParticulars?.length ? [particularsSummaryTable(summaryParticulars)] : []),
    ...(closingTables || []),
  ];
  for (const table of extraClosing) {
    const cols = table.columns || [];
    const tBody = (table.rows || []).map((row) => cols.map((c) => pdfCellFor(c, row)));
    if (table.totals) {
      tBody.push(cols.map((c, i) => (
        table.totals[c.key] != null && table.totals[c.key] !== ''
          ? pdfCellFor(c, table.totals)
          : (i === 0 ? String(table.totals[c.key] || 'TOTAL') : '')
      )));
    }
    let startY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 22 : cursorY + 40;
    const estimated = 28 + (tBody.length + 2) * 16;
    if (remainingPageSpace(doc, startY) < estimated) {
      doc.addPage();
      startY = 40;
    }
    if (table.title) {
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(String(table.title), 40, startY);
      startY += 8;
    }
    autoTable(doc, {
      startY,
      head: [cols.map((c) => c.label)],
      body: tBody,
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [17, 17, 17], textColor: 255, overflow: 'linebreak' },
      columnStyles: cols.reduce((acc, c, i) => {
        acc[i] = { halign: c.align === 'right' ? 'right' : 'left', overflow: 'linebreak' };
        return acc;
      }, {}),
      tableWidth: pageWidth - 80,
      rowPageBreak: 'avoid',
      didParseCell: (data) => {
        if (table.totals && data.row.index === tBody.length - 1 && data.section === 'body') {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  if (options.showSignature) {
    const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : cursorY + 40;
    let signY = finalY + 60;
    if (signY > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      signY = 80;
    }
    const labels = ['Verified By', 'Checked By', 'Approved By'];
    const slotWidth = (pageWidth - 80) / 3;
    labels.forEach((label, i) => {
      const x = 40 + i * slotWidth;
      doc.line(x, signY, x + slotWidth - 20, signY);
      doc.setFontSize(9);
      doc.text(label, x, signY + 12);
    });
  }

  doc.save(`${title.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
