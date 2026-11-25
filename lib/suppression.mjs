// suppression.mjs: load a do-not-contact file and match rows against it.
//
// Two layouts are read:
//   wide   a header with an "email" and/or "domain" column (website and company_domain also work)
//   typed  a "type,value" header, where type is "email" or "domain"
// Emails match exactly after lowercasing. Domains match on the root domain, against both the
// row's company domain and its email domain. A free-mail domain in the file is ignored, since
// "gmail.com" there would suppress every personal address on the list.
import { parseCsvRows, normHeader } from './csv.mjs';
import { emailDomain, emailKey, isEmailKey, registrableDomain } from './match-keys.mjs';
import { isFreemail } from './freemail.mjs';

export function loadSuppression(text) {
  const rows = parseCsvRows(text).filter((r) => r.some((c) => c.trim() !== ''));
  const sup = { rows: 0, emails: new Set(), domains: new Set(), ignored: [] };
  if (!rows.length) return sup;
  const header = rows[0].map(normHeader);
  const data = rows.slice(1);
  sup.rows = data.length;
  const addDomain = (v) => {
    const root = registrableDomain(v);
    if (!root) return;
    if (isFreemail(root)) sup.ignored.push(`${root} (free mail)`);
    else sup.domains.add(root);
  };
  const typeI = header.indexOf('type');
  const valueI = header.indexOf('value');
  if (typeI >= 0 && valueI >= 0) {
    for (const r of data) {
      const t = (r[typeI] || '').trim().toLowerCase();
      const v = (r[valueI] || '').trim();
      if (!v) continue;
      if (t === 'email' && isEmailKey(v)) sup.emails.add(emailKey(v));
      else if (t === 'domain') addDomain(v);
    }
    return sup;
  }
  const emailI = header.findIndex((h) => ['email', 'email_address', 'work_email'].includes(h));
  const domainI = header.findIndex((h) => ['domain', 'company_domain', 'website'].includes(h));
  if (emailI < 0 && domainI < 0) {
    throw new Error('suppression file needs an email or domain column, or a type,value header');
  }
  for (const r of data) {
    if (emailI >= 0 && isEmailKey(r[emailI])) sup.emails.add(emailKey(r[emailI]));
    if (domainI >= 0 && (r[domainI] || '').trim()) addDomain(r[domainI]);
  }
  return sup;
}

/** Collision reasons for one row, empty when the row is clear. */
export function matchSuppression(record, sup) {
  const hits = [];
  const e = emailKey(record.email);
  if (e && sup.emails.has(e)) hits.push(`email:${e}`);
  const roots = new Set([registrableDomain(record.company_domain), registrableDomain(emailDomain(record.email))]);
  for (const root of roots) {
    if (root && !isFreemail(root) && sup.domains.has(root)) hits.push(`domain:${root}`);
  }
  return hits;
}
