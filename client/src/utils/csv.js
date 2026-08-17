// Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes
// (""), commas and newlines inside quotes, and BOM/blank line skipping.
// Returns rows as arrays of strings.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop BOM from the first cell and skip fully-blank lines
  if (rows.length && rows[0].length) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// Turn parsed CSV rows into objects keyed by the header row.
export function csvToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] !== undefined ? r[i] : '';
    });
    return obj;
  });
}
