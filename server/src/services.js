// Outside services: RoofQuery, Stripe and email. Each one says whether it's connected.
import { config } from './config.js';

// RoofQuery lives in roofquery.js; re-exported here like Stripe.
export * as roofquery from './roofquery.js';

// Stripe lives in stripe.js; re-exported here so routes can use it like the other services.
export * as stripe from './stripe.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Plain text → simple HTML: links become clickable, line breaks are kept.
// A line like "Download the PDF report: https://…" becomes a link reading "Download the PDF report".
function toHtml(text) {
  const link = (u, label) => `<a href="${u}" style="color:#B03A0A;font-weight:600">${label}</a>`;
  const body = String(text).split('\n').map((line) => {
    const m = line.match(/^([^:]{2,60}):\s*(https?:\/\/\S+)$/);
    if (m) return link(esc(m[2]), esc(m[1]));
    return esc(line).replace(/https?:\/\/[^\s<]+/g, (u) => link(u, u));
  }).join('<br>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827;max-width:560px">${body}` +
    `<p style="margin-top:28px;font-size:12px;color:#6b7280">Rapid Squares · <a href="${esc(config.appUrl)}" style="color:#6b7280">${esc(config.appUrl.replace(/^https?:\/\//, ''))}</a></p></div>`;
}

export const email = {
  connected: () => !!config.email.resendKey,
  // Sends an email through Resend. Until Resend is connected, the message is printed in the server window instead.
  // Never throws: a failed email is logged, and the order or invite still goes through.
  async send({ to, subject, text }) {
    if (!config.email.resendKey) {
      console.log(`\n[email not sent: Resend isn't connected]\n  To: ${to}\n  Subject: ${subject}\n  ${String(text).split('\n').join('\n  ')}\n`);
      return { sent: false };
    }
    try {
      const res = await fetch(`${config.email.apiBase}/emails`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + config.email.resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.email.from, to: [to], subject, text, html: toHtml(text), ...(config.email.replyTo ? { reply_to: config.email.replyTo } : {}) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { console.error('[email]', res.status, data.name || '', data.message || '', '→', to); return { sent: false }; }
      console.log('[email] sent', JSON.stringify(subject), '→', to);
      return { sent: true, id: data.id };
    } catch (e) {
      console.error('[email] unreachable', e.message);
      return { sent: false };
    }
  }
};
