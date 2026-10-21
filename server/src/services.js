// Outside services: RoofQuery, Stripe and email. Each one says whether it's connected.
import { config } from './config.js';

// RoofQuery lives in roofquery.js; re-exported here like Stripe.
export * as roofquery from './roofquery.js';

// Stripe lives in stripe.js; re-exported here so routes can use it like the other services.
export * as stripe from './stripe.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Plain text → a branded HTML email. Blank lines start a new paragraph; a line like
// "Download the PDF report: https://…" becomes an orange button reading "Download the PDF report".
// Inline styles and tables only, so it looks right in Gmail, Outlook and Apple Mail.
const buttonLabel = (u) => (/\/storm-report\.html/.test(u) ? 'Open the storm report' : /\/orders\.html/.test(u) ? 'Open Home'
  : /invite=/.test(u) ? 'Accept the invite' : /\/signin\.html/.test(u) ? 'Sign in' : 'Open');
function toHtml(text) {
  const font = "Arial,Helvetica,sans-serif";
  const button = (u, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 18px"><tr><td style="border-radius:8px;background:#B03A0A">` +
    `<a href="${u}" style="display:inline-block;padding:12px 22px;font-family:${font};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px">${label}</a></td></tr></table>`;
  const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#B03A0A;font-weight:600">${u}</a>`);
  const blocks = String(text).trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n');
    const parts = lines.flatMap((line) => {
      // "Download the PDF report: https://…" → a button with that label.
      const m = line.match(/^([^:]{2,60}):\s*(https?:\/\/\S+)$/);
      if (m) return [{ button: button(esc(m[2]), esc(m[1])) }];
      // A sentence ending in a link ("…from your home page: https://…") → the sentence, then a short button.
      const s2 = line.match(/^(.{2,}?):\s*(https?:\/\/\S+)$/);
      if (s2) return [{ text: esc(s2[1]) + '.' }, { button: button(esc(s2[2]), buttonLabel(s2[2])) }];
      return [{ text: linkify(line) }];
    });
    // Runs of text lines stay together; buttons stand on their own.
    let html = '', run = [];
    const flush = () => { if (run.length) html += `<p style="margin:0 0 14px;font-family:${font};font-size:15px;line-height:1.55;color:#1B2630">${run.join('<br>')}</p>`; run = []; };
    parts.forEach((p) => { if (p.button) { flush(); html += p.button; } else run.push(p.text); });
    flush();
    return html;
  }).join('');
  const site = esc(config.appUrl), siteName = esc(config.appUrl.replace(/^https?:\/\//, ''));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#F3F1EC">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC"><tr><td align="center" style="padding:28px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #DEDAD1;border-radius:12px;overflow:hidden">` +
    `<tr><td style="background:#16222C;padding:18px 28px"><span style="font-family:${font};font-size:19px;font-weight:800;color:#FFFFFF">Rapid Squares</span>` +
    `<span style="font-family:${font};font-size:12px;color:#AEB8C1;padding-left:10px">Aerial Roof Reports</span></td></tr>` +
    `<tr><td style="padding:28px 28px 14px">${blocks}</td></tr>` +
    `<tr><td style="padding:16px 28px 22px;border-top:1px solid #EDEAE3;font-family:${font};font-size:12px;line-height:1.5;color:#6B7280">` +
    `Rapid Squares · <a href="${site}" style="color:#6B7280">${siteName}</a><br>Questions? Just reply to this email.</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

export { toHtml as emailHtml }; // used to preview the email design

export const email = {
  connected: () => !!config.email.resendKey,
  // Sends an email through Resend. Until Resend is connected, the message is printed in the server window instead.
  // attachments: [{ filename, content: Buffer }] (Resend allows up to 40 MB in all).
  // Never throws: a failed email is logged, and the order or invite still goes through.
  async send({ to, subject, text, attachments = [] }) {
    if (!config.email.resendKey) {
      const files = attachments.length ? `\n  Attached: ${attachments.map((a) => a.filename).join(', ')}` : '';
      console.log(`\n[email not sent: Resend isn't connected]\n  To: ${to}\n  Subject: ${subject}${files}\n  ${String(text).split('\n').join('\n  ')}\n`);
      return { sent: false };
    }
    try {
      const res = await fetch(`${config.email.apiBase}/emails`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + config.email.resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: config.email.from, to: [to], subject, text, html: toHtml(text), ...(config.email.replyTo ? { reply_to: config.email.replyTo } : {}),
          ...(attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {})
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { console.error('[email]', res.status, data.name || '', data.message || '', '→', to); return { sent: false }; }
      console.log('[email] sent', JSON.stringify(subject), '→', to, attachments.length ? `(${attachments.length} attached)` : '');
      return { sent: true, id: data.id };
    } catch (e) {
      console.error('[email] unreachable', e.message);
      return { sent: false };
    }
  }
};
