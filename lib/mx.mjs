// mx.mjs: class each email domain by the mail server its MX records point to.
//
// Classes: google, microsoft, other, none (the domain has no mail server), lookup-failed (the
// DNS answer never came back cleanly). The gate HOLDS a lookup-failed row: it is never passed
// as if it had been checked, because "we couldn't look" is not the same as "it's fine".
//
// The DNS resolver is injected. The default run uses a fixture resolver built from
// sample/mx-fixture.json, so the demo and the tests make no network calls. --live-dns swaps in
// node:dns. A resolver is any object with resolveMx(domain) that behaves like node:dns/promises:
// it returns [{ exchange, priority }] or throws an error with a code.

export const MX_CLASSES = ['google', 'microsoft', 'other', 'none', 'lookup-failed'];

const SIGNATURES = [
  ['microsoft', ['mail.protection.outlook.com', 'protection.partner.outlook', 'olc.protection.outlook.com', '.mx.microsoft']],
  ['google', ['aspmx.l.google.com', 'googlemail.com', 'smtp.google.com']],
];

// The answer itself says "no mail server here". Every other error code means we don't know.
const NO_MX_CODES = new Set(['ENODATA', 'ENOTFOUND']);

export function classify(mxHosts) {
  if (!mxHosts.length) return 'none';
  const joined = mxHosts.join(' ').toLowerCase();
  for (const [cls, sigs] of SIGNATURES) {
    if (sigs.some((s) => joined.includes(s))) return cls;
  }
  return 'other';
}

/** Resolve and class each domain with a small worker pool. Returns Map<domain, {mx, cls, error?}>. */
export async function classifyDomains(domains, resolver, { concurrency = 8 } = {}) {
  const results = new Map();
  const list = [...domains];
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const d = list[cursor++];
      try {
        const answer = await resolver.resolveMx(d);
        const mx = [...answer].sort((a, b) => a.priority - b.priority).map((r) => String(r.exchange));
        results.set(d, { mx, cls: classify(mx) });
      } catch (e) {
        const code = e?.code || 'EUNKNOWN';
        results.set(d, { mx: [], cls: NO_MX_CODES.has(code) ? 'none' : 'lookup-failed', error: code });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return results;
}

const dnsError = (code, domain) => Object.assign(new Error(`${code} ${domain}`), { code });

/**
 * Resolver over a fixture: { "mx": { "<domain>": ["host", ...] | [] | { "error": "<CODE>" } } }.
 * An empty list answers "no mail server" (ENODATA). A domain the fixture doesn't list throws
 * ENOFIXTURE, which classes as lookup-failed: an unknown domain is held, never guessed.
 */
export function fixtureResolver(fixture) {
  const table = fixture?.mx ?? {};
  return {
    async resolveMx(domain) {
      if (!Object.hasOwn(table, domain)) throw dnsError('ENOFIXTURE', domain);
      const entry = table[domain];
      if (entry && !Array.isArray(entry)) throw dnsError(entry.error || 'EUNKNOWN', domain);
      if (!entry.length) throw dnsError('ENODATA', domain);
      return entry.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }));
    },
  };
}

/** The real thing. Only used with --live-dns. */
export async function liveResolver() {
  const dns = await import('node:dns/promises');
  return { resolveMx: (d) => dns.resolveMx(d) };
}
