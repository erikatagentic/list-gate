// dedup.mjs: drop repeat people, first row wins.
//
// A later row is a duplicate of an earlier kept row when any one of these keys matches:
//   email       lowercased and trimmed, so "Dana.Rowe@x.example" and "dana.rowe@x.example" match
//   linkedin    the "in/<slug>" key, whatever the URL spelling
//   name+root   the same full name at the same root domain (www., sub-domains and paths removed)
// The root domain is a key for the person at that company, not for the company alone: two
// different people at one firm are two leads. "One domain owning too many rows" is a separate
// sanity check in sanity.mjs.
import { emailKey, isEmailKey, linkedinKey, personKey, registrableDomain } from './match-keys.mjs';

export function rowKeys(row) {
  const email = isEmailKey(row.email) ? emailKey(row.email) : '';
  const li = linkedinKey(row.linkedin_url);
  const root = registrableDomain(row.company_domain);
  const person = personKey(row.full_name);
  return {
    email,
    linkedin: li.startsWith('in/') ? li : '',
    name_root: person && root ? `${person}|${root}` : '',
  };
}

/**
 * rows: [{ row: <line number>, record: {field: value} }]
 * Returns { kept, dropped } where each dropped entry is
 *   { ...entry, reason: 'duplicate:<key>', kept_row }.
 */
export function dedupRows(rows) {
  const seen = { email: new Map(), linkedin: new Map(), name_root: new Map() };
  const kept = [];
  const dropped = [];
  for (const entry of rows) {
    const keys = rowKeys(entry.record);
    let hit = null;
    for (const kind of ['email', 'linkedin', 'name_root']) {
      const k = keys[kind];
      if (k && seen[kind].has(k)) { hit = { kind, keptRow: seen[kind].get(k) }; break; }
    }
    if (hit) {
      dropped.push({ ...entry, reason: `duplicate:${hit.kind}`, kept_row: hit.keptRow });
      continue;
    }
    for (const kind of Object.keys(seen)) if (keys[kind]) seen[kind].set(keys[kind], entry.row);
    kept.push(entry);
  }
  return { kept, dropped };
}
