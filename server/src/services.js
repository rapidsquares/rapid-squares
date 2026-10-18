// Outside services. Each one says whether it's connected; the real calls are added in the
// next build steps (RoofQuery → Stripe → SendGrid). Until then they explain what's missing.
import { config } from './config.js';
import { fail } from './http.js';

export const roofquery = {
  connected: () => !!config.roofquery.apiKey,
  // Places the measurement order. Returns { roofquery_order_id } once connected.
  async placeOrder(/* order, company */) { return null; },
  notConnected(what) { fail(501, 'not_connected', `${what} will be available once RoofQuery is connected.`); }
};

// Stripe lives in stripe.js; re-exported here so routes can use it like the other services.
export * as stripe from './stripe.js';

export const email = {
  connected: () => !!config.email.sendgridKey,
  // Sends an email. Until SendGrid is connected, the message is printed in the server window instead.
  async send({ to, subject, text }) {
    console.log(`\n[email not sent: SendGrid isn't connected]\n  To: ${to}\n  Subject: ${subject}\n  ${String(text).split('\n').join('\n  ')}\n`);
    return { sent: false };
  }
};
