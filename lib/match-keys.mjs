// match-keys.mjs: the ONE place matching keys are computed.
//
// Why one module: four hand-written copies of this logic had each drifted a little (a
// different legal-suffix list here, a missing "www." strip there), so the same company got
// different keys in different jobs and duplicates slipped through without an error. Dedup,
// suppression and the sanity checks all import from here.
//
// Two normalisations that are never mixed up:
//   matching keys  lowercase, legal suffixes stripped, root domain. Used to compare rows.
//   display name   company_name_clean, shipped next to the raw company field. Used by people.

// Two-label public suffixes, so "shop.acme.co.uk" keys as "acme.co.uk", not "co.uk".
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'govt.nz',
  'co.za', 'org.za', 'co.jp', 'or.jp', 'ne.jp', 'com.br', 'com.mx', 'com.sg', 'com.hk',
  'com.my', 'co.in', 'co.id', 'com.tr', 'com.cn', 'com.tw', 'co.kr', 'co.il', 'com.ar',
  'com.co', 'com.ph', 'com.vn',
]);

const LEGAL = new Set([
  'inc', 'incorporated', 'llc', 'corp', 'corporation', 'ltd', 'limited', 'co', 'company',
  'plc', 'pllc', 'pc', 'pa', 'pl', 'lp', 'llp', 'gmbh', 'group', 'holdings', 'the', 'dba',
  'pty', 'sa', 'sl', 'and',
]);

/** Full hostname: scheme, path, query, port and a leading "www." removed. */
export function normalizeHost(s) {
  let d = String(s ?? '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  d = d.split(/[/?#]/)[0].split(':')[0].replace(/\.+$/, '');
  return d.startsWith('www.') ? d.slice(4) : d;
}

/** Registrable (root) domain, using the two-label suffix table above. */
export function registrableDomain(s) {
  const d = normalizeHost(s);
  if (!d) return '';
  const parts = d.split('.');
  if (parts.length >= 3 && MULTI_LABEL_SUFFIXES.has(parts.slice(-2).join('.'))) {
    return parts.slice(-3).join('.');
  }
  return parts.length >= 2 ? parts.slice(-2).join('.') : d;
}

/** Company matching key. "Acme Corp, Inc." and "acme corporation" both give "acme". */
export function normName(s) {
  const words = String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !LEGAL.has(w));
  return words.join('').slice(0, 80);
}

export const emailKey = (e) => String(e ?? '').trim().toLowerCase();

export const isEmailKey = (e) => /^[^@\s]+@[^@.\s]+(?:\.[^@.\s]+)+$/.test(emailKey(e));

export const emailDomain = (e) => {
  const k = emailKey(e);
  return k.includes('@') ? normalizeHost(k.slice(k.lastIndexOf('@') + 1)) : '';
};

/** "in/<slug>" or "company/<slug>" for a LinkedIn URL in any common spelling, else "". */
export function linkedinKey(url) {
  const normalized = String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^[a-z]{2}\.(?=linkedin\.com(?:\/|$))/, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '');
  const m = normalized.match(/(?:^|linkedin\.com\/)(in|company)\/([^/]+)/);
  if (!m) return '';
  let slug = m[2];
  try { slug = decodeURIComponent(slug); } catch { /* keep the raw slug */ }
  return `${m[1]}/${slug}`;
}

/** Person-name key. Trims, collapses spaces and lowercases. It removes nothing else, because
 *  every character it might strip (an accent, a hyphen, a second surname) can be the only
 *  thing telling two different people apart. */
export const personKey = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// Emoji and pictographs, stripped from the display name only.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** company_name_clean: the display name a person reads. Whitespace collapsed, emoji removed,
 *  the trade name kept after "DBA", and an all-lowercase name title-cased. A name that already
 *  has capitals is left alone, since "iRobot" or "ACME" is the company's own spelling. */
export function displayName(raw) {
  let s = String(raw ?? '').replace(PICTOGRAPHS, '').replace(/\s+/g, ' ').trim();
  const dba = s.match(/\b(?:d\/b\/a|dba)\b[\s:.-]*(.+)$/i);
  if (dba && dba[1].trim()) s = dba[1].trim();
  if (s && s === s.toLowerCase() && /[a-z]/.test(s)) {
    s = s.replace(/(^|[\s(/-])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
  }
  return s;
}
