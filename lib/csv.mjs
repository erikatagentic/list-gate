// csv.mjs: one quote-aware CSV parser, a row-width guard, a writer, and the header alias map.
//
// Why a real parser: splitting each line on a bare comma shifts every later column by one as
// soon as an earlier field holds a comma ("Acme, Inc"). On one real list that silently lost
// 151 of 1,268 domains (12%) while the run still reported success. Every module here reads
// CSV through this file so the fix lives in one place.

export function parseCsvRows(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
      if (c === '\r' && src[i + 1] === '\n') i++;
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Data rows whose field count differs from the header's. Each entry carries the file line
// number (header is line 1), so a column shift turns into a loud, located failure.
export function badRowWidths(rows) {
  if (!rows.length) return [];
  const width = rows[0].length;
  const bad = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== width) bad.push({ row: i + 1, fields: rows[i].length, expected: width });
  }
  return bad;
}

export function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

// ---- header aliases ----
// Kept small on purpose. A header is compared after lowercasing and turning spaces, dots,
// slashes and dashes into underscores, so "Work Email" and "work-email" both read as work_email.
// A bare "name" is left out: on company exports it is the company, on people lists the person.
export const HEADER_ALIASES = {
  email: ['email', 'email_address', 'work_email', 'e_mail'],
  first_name: ['first_name', 'firstname', 'first'],
  last_name: ['last_name', 'lastname', 'last', 'surname'],
  full_name: ['full_name', 'fullname', 'contact_name', 'person_name'],
  company: ['company', 'company_name', 'organization', 'account_name'],
  company_domain: ['company_domain', 'domain', 'website', 'company_website'],
  linkedin_url: ['linkedin_url', 'linkedin', 'person_linkedin_url', 'linkedin_profile'],
};

export const REQUIRED_FIELDS = ['email', 'first_name', 'last_name', 'full_name', 'company', 'company_domain'];

export const normHeader = (h) => String(h ?? '').trim().toLowerCase().replace(/[\s./-]+/g, '_');

// Returns { columns: {field: index}, canonicalHeader, error }. Two headers that map to the same
// field is an error rather than a silent first-wins pick.
export function mapHeaders(header) {
  const columns = {};
  const canonicalHeader = header.map((h) => String(h).trim());
  const repeated = canonicalHeader.find((h, i) => canonicalHeader.indexOf(h) !== i);
  if (repeated !== undefined) return { error: `the header repeats "${repeated}"` };
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const hits = header.flatMap((h, i) => (aliases.includes(normHeader(h)) ? [i] : []));
    if (hits.length > 1) {
      return { error: `columns ${hits.map((i) => `"${header[i]}"`).join(' and ')} both read as ${field}; rename one` };
    }
    if (hits.length) {
      columns[field] = hits[0];
      canonicalHeader[hits[0]] = field;
    }
  }
  const missing = REQUIRED_FIELDS.filter((f) => columns[f] === undefined);
  if (missing.length) {
    return { error: `no column for ${missing.join(', ')}. Accepted headers: ${missing.map((f) => `${f} (${HEADER_ALIASES[f].join(', ')})`).join('; ')}` };
  }
  return { columns, canonicalHeader };
}
