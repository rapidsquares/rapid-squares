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

export const stripe = {
  connected: () => !!config.stripe.secretKey,
  // Charges the company's saved card for an order. Returns { payment_id } once connected.
  async chargeOrder(/* company, amountCents, description */) { return null; },
  async portalUrl(/* company */) { return null; }
};

export const email = {
  connected: () => !!config.email.sendgridKey,
  // Sends an email. Until SendGrid is connected, the message is printed in the server window instead.
  async send({ to, subject, text }) {
    console.log(`\n[email not sent: SendGrid isn't connected]\n  To: ${to}\n  Subject: ${subject}\n  ${String(text).split('\n').join('\n  ')}\n`);
    return { sent: false };
  }
};
