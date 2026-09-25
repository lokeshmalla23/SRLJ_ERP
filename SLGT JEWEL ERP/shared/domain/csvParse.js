/**
 * RFC-style CSV parser used by inventory/backup import.
 * Accepts comma, semicolon, or tab files (Excel locale variants) and a UTF-8 BOM.
 */

function countUnquoted(headerLine, ch) {
  let n = 0;
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i += 1) {
    const c = headerLine[i];
    if (c === '"') {
      if (inQuotes && headerLine[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ch) n += 1;
  }
  return n;
}

export function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/)[0] || '';
  const comma = countUnquoted(firstLine, ',');
  const semi = countUnquoted(firstLine, ';');
  const tab = countUnquoted(firstLine, '\t');
  if (tab > comma && tab >= semi) return '\t';
  if (semi > comma) return ';';
  return ',';
}

export function parseCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { headers: [], rows: [], delimiter: ',' };

  const delimiter = detectDelimiter(raw);
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;

  while (i < raw.length) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field.trim());
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && raw[i + 1] === '\n') i += 1;
      row.push(field.trim());
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);

  if (!rows.length) return { headers: [], rows: [], delimiter };

  const headers = rows[0].map((h) => h.trim());
  const data = rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = cols[idx] ?? '';
    });
    return obj;
  });
  return { headers, rows: data, delimiter };
}

export function looksLikeSpreadsheet(fileName, text) {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.ods')) return true;
  const sample = String(text || '').slice(0, 8);
  return sample.startsWith('PK');
}
