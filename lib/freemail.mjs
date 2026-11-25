// freemail.mjs: free-mail domains and role addresses. Both are flags, never drops. A person
// can use a personal address on purpose, and "info@" can be the only inbox a small firm has,
// so the gate tags the row and lets whoever loads the list decide.
import { domainToASCII } from 'node:url';

// Short on purpose: consumer mailbox providers only. A false match hides a real company.
export const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me',
  'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com',
  'fastmail.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
  'yahoo.co.uk', 'hotmail.co.uk', 'btinternet.com', 'web.de', 'gmx.de',
]);

export const ROLE_LOCAL_PARTS = new Set([
  'info', 'hello', 'contact', 'sales', 'support', 'admin', 'office', 'team', 'marketing',
  'billing', 'accounts', 'help', 'hr', 'jobs', 'careers', 'enquiries', 'inquiries',
  'webmaster', 'noreply', 'no-reply', 'mail', 'general',
]);

/** True for a free-mail domain or any sub-domain of one. Dot boundaries matter, so
 *  "notgmail.com" is not free mail. */
export function isFreemail(domain, set = FREEMAIL) {
  let d = domainToASCII(String(domain ?? '').trim().toLowerCase().replace(/\.$/, ''));
  if (!d) return false;
  while (d.includes('.')) {
    if (set.has(d)) return true;
    d = d.slice(d.indexOf('.') + 1);
  }
  return false;
}

/** True when the local part is a shared role inbox ("info", "sales+eu"). */
export function isRoleAddress(email) {
  const s = String(email ?? '').trim().toLowerCase();
  if (!s.includes('@')) return false;
  const local = s.slice(0, s.lastIndexOf('@')).split('+')[0];
  return ROLE_LOCAL_PARTS.has(local);
}
