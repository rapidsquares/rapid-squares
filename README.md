# Rapid Squares

Aerial roof reports: look up a property, order a measurement report or a Storm Report, and download branded PDFs and Xactimate (ESX) files. The website is plain HTML, CSS and JavaScript; the Node.js server in `server/` serves it, keeps the data in Supabase, takes payments through Stripe, orders reports from RoofQuery and sends email through Resend. Opened without the server, the site runs on made-up sample data (see below).

## Screens

| File | Screen |
| --- | --- |
| `index.html` | **Landing page**: what Rapid Squares is, address search, sample report, prices, FAQ and contact |
| `orders.html` | **Home**: order a new report (pop-up) and see ordered reports with status filters and search |
| `order.html` | **Order form**, step by step: address and report type (and what to measure) → confirm the roof on the map (Azure Maps satellite imagery) → review, job details and place. Shown in the Home pop-up; visitors without an account use it as a page, and signed-in visits forward to Home |
| `report.html` | **Roof report**: opens from a Home row. Summary, RoofQuery's drawings (Lengths, Area, Pitch; whole property or one building), edge measurements, waste factor, pitch breakdown, buildings and job details, loaded live from RoofQuery. The PDF and ESX are under Files, where the ESX can also be added (it downloads and is emailed) |
| `storm-report.html` | **Storm Report**: the results (damage chance, hail, wind, tornadoes, every storm day) and its five PDFs. Date of loss, claim number, insured name and notes are asked when a PDF is downloaded |
| `account.html` | **Settings**: **Profile** (name, job title, time zone, sign-in email, sign out), **Company & branding** (company name, license number, logo, colors and the one set of contact details printed on reports), **Team & invites** (admin) and **Billing** |

On desktop the sidebar links Home, New order and Settings; on phones the bottom bar does.

## Mobile

The site is a mobile-first website. On screens 720px wide or narrower it changes in several ways:

- The sidebar becomes a bottom bar: Home, Order, Settings.
- Tables turn into stacked cards with labeled rows, and Home's report cards stack.
- Forms switch to a single column, with 16px inputs so iOS doesn't zoom in.
- Settings sections become a row of buttons that wraps.
- Pop-ups slide up from the bottom; swipe down to close them. The page behind stays still.

You can also add it to a phone's home screen. In Safari use Share › Add to Home Screen, or in Chrome use the ⋮ menu › Add to Home screen. It then opens full-screen with its own icon, using `manifest.webmanifest`, `icon.svg` and the `icon-*.png` files.

## Sample data (no server)

Opened without the Node.js server (as plain files, or with `start-windows.bat`), the pages have no server to talk to, so `sample-api.js` answers the same calls the server does in the browser with sample data for a fictional company, "Lone Star Roofing Co." The data is saved in that browser's local storage, so changes stay after a reload. Nothing is sent anywhere.

Sample data follows the server's rules:

- Every request is limited to the signed-in person's company.
- Permissions are checked. For example, a Viewer can't order reports, and an Estimator only sees reports they ordered.
- Invitations expire after 7 days (Resend makes a new link). Monthly order limits were removed.
- Errors come back in the same `{ "error": { "code", "message" } }` shape.
- Orders placed on sample data move from Ordered to Processing to Ready by themselves, within about a minute.

What works on sample data:

- **Home:** filters, search and paging, from the data.
- **Order pop-up:** places an order (Storm Reports are ready straight away).
- **Settings › Company & branding:** saves company details and the logo.
- **Team:** invite, edit permissions, remove, resend and revoke.
- **Settings › Profile and Billing:** saves your profile, and shows billing.

PDF and ESX downloads, Stripe's billing page, and sign-out show a short message explaining they need RoofQuery, Stripe or Supabase connected first.

**Sample data:** the site signs you in as the company owner. To start over, clear this site’s data in your browser.

**Switching to the real backend:** set `apiBaseUrl` in `config.js` to the backend's address, for example `https://api.rapidsquares.com`. The pages stay the same. `api.js` sends the same calls to the server instead.

## Address lookup (Azure Maps)

The **order pop-up** (`order.html`) searches addresses and shows an aerial view of the property. It uses three parts of Azure Maps:

- **Autocomplete** (`/geocode:autocomplete`, Search API 2026-01-01) suggests addresses as you type.
- **Geocoding** (`/geocode`) turns the address you pick into coordinates.
- **Web SDK v3** shows the `satellite` map style zoomed in on the roof, with a pin on the property and a switcher for satellite, satellite with labels, or road views.

### Turning it on

1. In the Azure portal, create an **Azure Maps account**. The Gen2 pricing tier includes a free monthly allowance.
2. Open the account and go to **Settings › Authentication**, then copy the **Primary Key**.
3. Paste the key into `config.js`:
   ```js
   azureMapsKey: 'your-key-here',
   ```
4. Open `order.html` and start typing an address.

Until a key is added, the page shows a notice and makes no calls to Azure.

### Keeping the key safe

The key in `config.js` is visible to anyone who opens the site. A public repo also exposes it to anyone who reads the code. Before you share the site:

- In the Azure portal, set **Settings › CORS** on the Maps account to allow only your site's address, for example `https://yourname.github.io`.
- Consider keeping the real key out of git. Commit `config.js` with an empty key and add the key only where the site is hosted.
- For a production app, switch to Microsoft Entra ID or SAS-token authentication instead of a subscription key.

You can change the search country (`countryRegion`) and how far the map zooms in on a roof (`propertyZoom`) in `config.js`.

## Running it locally

### Windows: double-click to start

1. Unzip the folder. If Windows blocks the files, right-click the zip first, choose **Properties**, tick **Unblock**, click **OK**, and then unzip.
2. Double-click **`start-windows.bat`**.
3. The site opens in your browser at `http://localhost:8000`. Leave the black window open while you work, and close it to stop the site.

This uses PowerShell, which is built into Windows, so you don't need to install anything. If port 8000 is busy, it uses 8001 and so on, and the window shows the address. Edits to the files appear when you reload the page.

If Windows shows **"Windows protected your PC"**, click **More info › Run anyway**. That warning appears for any script downloaded from the internet.

### Mac or Linux

Run this in the folder, then open `http://localhost:8000`:
```
python3 -m http.server 8000
```

### Using the address lookup locally

Add your key to `config.js`. If you've restricted the key in Azure (Settings › CORS), also add `http://localhost:8000` there.

## Running with real accounts (Supabase)

The steps above run the site on **sample data**. To use real sign-in and a real database, run the Rapid Squares server in the `server` folder instead. It serves the same website, plus the backend that talks to Supabase. Every read and write goes through it; the browser never touches the database directly.

You need Node.js 22 or newer (`node -v` to check).

### 1. Set up the database (once)

1. In Supabase, open your project › **SQL Editor** › **New query**.
2. Open `supabase/schema.sql` from this folder in Notepad, copy all of it, paste it in, and click **Run**. It's safe to run again later.

### 2. Point Supabase sign-in at your site (once)

In Supabase › **Authentication** › **URL Configuration**:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** add `http://localhost:3000/**`

When the site goes online, change these to `https://rapidsquares.com`.

### 3. Add your keys

1. Double-click **`start-live.bat`**. The first time, it creates `server\.env` and opens it in Notepad.
2. Fill in these three lines from Supabase › **Project Settings** › **API Keys** (and **Data API** for the URL):
   - `SUPABASE_URL`: the project URL, like `https://abcd1234.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: the **publishable** key (starts `sb_publishable_`, or the older "anon" key)
   - `SUPABASE_SECRET_KEY`: the **secret** key (starts `sb_secret_`, or the older "service_role" key)
3. Save and close Notepad.

`server\.env` holds your secret key. It stays on your computer: `.gitignore` keeps it out of the repo, and the server never sends it to browsers. Don't paste it into chat, email or the code.

### 4. Start it

Double-click **`start-live.bat`** again. It checks each setting, tells you in plain words if something's wrong, then opens `http://localhost:3000`. Leave the window open; close it to stop.

On Mac or Linux: `cd server`, `cp .env.example .env`, fill it in, then `npm run check` and `npm start`.

### What works now

- **Landing page** at `/` (`index.html`) with an address search, the sample report, prices, FAQ and contact.
- **No account needed** on the order page (`order.html`): visitors can look up a roof, see report types and regular prices, and either order as a guest (name + email) or create a free account, which brings them back to the same order. Guest orders are saved as "awaiting payment" and are never sent to RoofQuery until payment is connected. Order history, Report settings, Team and Account still need sign-in.

- **Create an account**, then name your company. Each company can try a subscription free for 30 days (`TRIAL_DAYS`): Stripe collects a card at the start, subscriber prices apply during the trial, and the plan begins on day 31 unless they cancel. Free reports on sign-up are off by default (`FREE_REPORTS_ON_SIGNUP=0`); any a company already has are still used first.
- **Company & branding, profile and logo uploads** save to Supabase.
- **Team invites:** until Resend is connected, invites aren't emailed. The Team page shows each person's invite link to send yourself, and the server window prints the email it would have sent. Each link works once, for that email address only.
- **Ordering** creates the report record with the right price (free report, subscriber or regular price, ESX add-on). Until Stripe and RoofQuery are connected, nothing is charged and the report waits as "pending". `ALLOW_UNPAID_TEST_ORDERS=true` allows this; set it to `false` before launch.
- **Reports:** each one has its own page (`report.html` or `storm-report.html`) with the results and files. Report emails attach the PDFs.

### Payments (Stripe)

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (in `server\.env` and on Render) and the site takes real payments:

- **Orders:** free reports are used first. Then the saved card is charged right away. With no saved card (or if the bank wants the customer to confirm), the buyer goes to Stripe's secure payment page and the card is saved for next time.
- **Guests** always pay on Stripe's page; the order is only sent on once Stripe confirms payment.
- **Account › Billing:** add or update the card, subscribe ($100/month or $1,000/year, from `SUBSCRIPTION_MONTHLY_CENTS` / `SUBSCRIPTION_YEARLY_CENTS`), manage or cancel through Stripe's billing page, and open a receipt for each charge.
- **Webhook:** Stripe must be able to call `https://<your site>/webhooks/stripe`. Card saving, subscriptions and payment-page orders finish there.
- When Stripe is connected, `ALLOW_UNPAID_TEST_ORDERS` no longer matters for paid orders; set it to `false`.

### Good to know

- Supabase emails a confirmation link to new accounts, and its built-in email only sends a few an hour. For testing, you can turn off **Confirm email** under Authentication › Sign In / Providers › Email. Turn it back on before launch.
- **RoofQuery:** set `ROOFQUERY_API_KEY` (and `ROOFQUERY_WEBHOOK_SECRET`, `ADMIN_EMAIL`) in `server/.env` and on Render, then add the webhook `https://rapidsquares.com/webhooks/roofquery/<ROOFQUERY_WEBHOOK_SECRET>` in the RoofQuery portal. Paid and free orders are sent to RoofQuery straight away; status, squares and pitch update from the webhook (and every few minutes as a backup). When a report is ready the person who ordered it gets an email; guests get download links. PDFs carry the ordering company's name, logo, color and contact details (a RoofQuery brand profile per company, kept in step with Report settings); guest PDFs use the default branding set in the RoofQuery portal. Downloads go through this server, so the ESX file is only available on orders that paid for it. If RoofQuery can't measure a roof, the order is marked failed and the customer is refunded automatically (or gets their free report back). If the RoofQuery balance runs out, orders queue, `ADMIN_EMAIL` is told, and they're retried automatically. With a `rq_test_sk_` key, only RoofQuery's sandbox addresses complete (e.g. 6515 Turnbridge Pl, Prospect, KY 40059); any other address is cancelled, which also tests the refund.
- **Buying the ESX later:** RoofQuery makes an ESX file for every report, so a finished report without one shows **Add ESX file · $5.00** under Files on its report page (saved card charged, the file downloads and is emailed; no card → Stripe's payment page). Guests get a "Get it for $5" link in their ready email. The purchase shows on Account billing, and the buyer gets an email with the download link.
- **Instant Squares:** coming soon. The landing page lists it; the server already has the RoofQuery Instant Query route (`/api/instant-query`, subscribers only) for when it launches.
- **Order emails:** the customer gets an order confirmation as soon as an order is paid (or covered by a free report) and a "report ready" email when it's done. `ADMIN_EMAIL` gets a copy of both (turn off with `ORDER_ALERTS=false`).
- **Email (Resend):** set `RESEND_API_KEY` and `EMAIL_FROM` (an address on a domain verified in Resend › Domains) in `server/.env` and on Render. The site then emails guest order confirmations, payment confirmations and team invites. Supabase's sign-up and password-reset emails are separate: point Supabase › Authentication › Emails › SMTP Settings at Resend (host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key) to send them from your domain and lift the few-an-hour limit. `npm run check` tells you whether the key works and the domain is verified.
- **Azure key on the real server:** put it in `server\.env` as `AZURE_MAPS_KEY=` (and in Render's environment variables when hosted) instead of `config.js`, so it never goes on GitHub. The server hands it to the order page.
- If your Azure Maps key has CORS rules, add `http://localhost:3000` to them.
- Opening the site with `start-windows.bat` (port 8000) uses sample data, so you can try every page without signing in.

## Without the server

Double-click `index.html`, or run `start-windows.bat`, to try the site on sample data. Most things work; use `start-windows.bat` (a local web server) for the address lookup, since browsers block it from plain files.

## Notes for reviewers

- Fonts load from Google Fonts: Archivo, IBM Plex Sans, and IBM Plex Mono.
- `start-windows.bat` and `serve.ps1` run the site on sample data; `start-live.bat` runs the real server in `server/`. The website itself doesn't use any of them.
- Shared styles are in `styles.css`. Page behavior is in `app.js`, the order pop-up is in `order-form.js`, address suggestions for other fields are in `address-suggest.js`, and calls to the server go through `api.js`. On sample data, `sample-api.js` answers them; on the real server, the `server/` backend does, and `auth.js` and `signin.html` handle sign-in.
- Names, emails and addresses in the sample data are made up.
