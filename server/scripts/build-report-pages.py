"""Writes the four public report pages (residential-roof-report.html, rapid-squares.html, commercial-roof-report.html,
hail-storm-report.html) from one template. Change the content below, then run: python3 server/scripts/build-report-pages.py"""
import json, html
import os
SITE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE = 'https://rapidsquares.com'
e = html.escape

LOGO = open(SITE + '/index.html').read().split('<svg class="brand-mark"', 1)[1].split('</svg>', 1)[0]
LOGO = '<svg class="brand-mark"' + LOGO + '</svg>'

PAGES = [
  dict(
    slug='residential-roof-report', blurb='Full report: every edge, diagrams, waste table', id='premium_residential', name='Premium Residential Roof Report', short='Premium Residential',
    price=1200, sub=700, img='residential-summary.jpg', og='og-residential.jpg', sample='sample-report.pdf',
    title='Residential Roof Measurement Report in 2 Hours | Rapid Squares',
    desc='Aerial residential roof reports in under 2 hours: total squares, pitch, every edge length, a waste table and roof diagrams. Xactimate ESX add-on available.',
    eyebrow='Residential roof report',
    h1='Residential roof measurement reports in under 2 hours',
    lede='A full aerial measurement of the house, and the detached garage or every building if you choose: total area and squares, the pitch of every face, every edge measured, a waste factor table and labeled roof diagrams. Ready to quote, order material from, or import into Xactimate.',
    facts=[('Delivered', 'In under 2 hours'), ('Files', 'PDF report, with an Xactimate ESX for <span data-price="esx">$5</span> more'), ('Measures', 'Main building, + detached garage, or every building'), ('Coverage', 'United States and Canada')],
    features=[
      ('residential-summary.jpg', 'Report summary page: structure diagram, edge measurements, total area, total edges, waste factor and pitch breakdown', 'Every measurement on one page',
       'Each building gets a summary with its roof plan and the numbers you quote from.',
       ['Total roof area in square feet and roofing squares', 'Predominant pitch, and the area at every pitch', 'Eaves, rakes, ridges, hips, valleys, step and wall flashing, each with its length and count', 'Waste factor table from 0% to 24%, rounded up to the next bundle']),
      ('residential-lengths.jpg', 'Length diagram: every roof edge colored by type and labeled with its true sloped length in feet', 'Labeled roof diagrams',
       'Three drawings for each building, so crews and adjusters see exactly what was measured.',
       ['Length diagram: every edge, colored by type, with its true sloped length', 'Area diagram: each roof face with its square footage', 'Pitch diagram: each face with its pitch and the direction it slopes']),
      ('residential-overview.jpg', 'Property overview page with a high-resolution aerial photo of the house', 'Aerial photo of the property',
       'A top-down photo of the property, so the report matches the roof you\'re quoting.',
       ['High-resolution aerial image', 'Address, report date and your company details on every page', 'Your logo, colors and contact details on the report, not ours']),
    ],
    steps=[('Search the address', 'Type the address and pick it from the suggestions.'), ('Confirm the roof', 'Check the pin on the aerial map and choose what to measure.'), ('Get the report', 'It\'s emailed to you, PDF attached, in under 2 hours, and it\'s on your Home page any time.')],
    prose=['A roofing square is 100 square feet of roof surface, and it\'s how shingles and most roofing materials are sold. Every Premium Residential report gives the total in square feet and in squares, plus the squares to order at each common waste allowance, so a takeoff takes minutes instead of a ladder trip.',
           'Every report is measured from high-resolution aerial imagery and checked before it\'s delivered. Reports are remote estimates: verify on site before you order material for a complex roof.'],
    faq=[
      ('How long does a residential roof report take?', 'Premium Residential reports are delivered in under 2 hours. You get an email when measuring starts and another, with the PDF attached, when the report is ready.'),
      ('What does a residential roof report include?', 'Total roof area and squares, the pitch of every face, the length of every eave, rake, ridge, hip, valley and flashing, a waste factor table, an aerial photo, and length, area and pitch diagrams for each building.'),
      ('Can I get an Xactimate (ESX) file?', 'Yes. Add the Xactimate ESX file for $5 when you order, or from the report page afterwards. If you enter a claim number, the ESX file is named after it.'),
      ('Which buildings are measured?', 'You choose when ordering: the main building only, the main building and its detached garage, or every building on the property.'),
      ('How much does a residential roof report cost?', 'A Premium Residential report is $12, or $7 with a subscription. New accounts get their first Premium reports free.'),
      ('Can I put my company\'s branding on the report?', 'Yes. Add your logo, colors and contact details in Settings, and every report you order carries them.'),
      ('How accurate is an aerial roof report?', 'Reports are measured from high-resolution aerial imagery and are suited to quoting and ordering material. They are remote estimates, so verify on site for complex roofs or where trees cover the roof.'),
    ]),
  dict(
    slug='rapid-squares', blurb='Squares at every pitch, one page', id='certified_residential', name='Rapid Squares Roof Report', short='Rapid Squares',
    price=800, sub=500, img='rapid-squares-report.jpg', og='og-rapid-squares.jpg', sample='samples/rapid-squares-sample.pdf',
    title='Roof Squares at Every Pitch in 30 Minutes | Rapid Squares',
    desc='Roofing squares for every building at any address, at every pitch from 1/12 to 12/12 with 10% to 15% waste, in under 30 minutes. One-page PDF.',
    eyebrow='Rapid Squares',
    h1='Roof squares for any address in under 30 minutes',
    lede='Rapid Squares outlines every building on an aerial photo and gives you the squares at an estimated pitch, and at every other pitch from 1/12 to 12/12, with 10%, 12% and 15% waste. Everything you need to quote a roof or order shingles, on one page.',
    facts=[('Delivered', 'In under 30 minutes'), ('Files', 'One-page PDF'), ('Measures', 'Every building, outlined on the photo'), ('Coverage', 'United States and Canada')],
    features=[
      ('rapid-squares-report.jpg', 'Rapid Squares one-page report: aerial photo with each building outlined, measurements, and squares by pitch and waste for every building', 'Squares by pitch and waste, building by building',
       'A table for each building with its squares at every pitch, so you can use your own pitch if you know it.',
       ['Squares at every pitch from 1/12 to 12/12', 'With 10%, 12% and 15% waste, rounded up to the bundle', 'An estimated pitch for each building, marked in the table', 'Footprint, perimeter and roof area for the whole property']),
      ('rapid-squares-outlines.jpg', 'Aerial photo with each building outlined in its own color', 'Every building outlined',
       'Each building is outlined on the aerial photo in its own color, matching its row in the table, so the house, garage and sheds are easy to tell apart.',
       ['Outlined on a recent aerial photo', 'Every structure on the property, numbered', 'On the report page, pick any building to see it on its own']),
    ],
    steps=[('Search the address', 'Type the address and pick it from the suggestions.'), ('Pick Rapid Squares', 'Confirm the roof on the map. Every building is included.'), ('Quote in minutes', 'The one-page report is emailed to you in under 30 minutes.')],
    prose=['Rapid Squares is built for the first conversation with a homeowner: how many squares, at what pitch, and how much to order. When you need every edge length, the roof diagrams or an Xactimate file, order a Premium Residential report instead.'],
    faq=[
      ('What is Rapid Squares?', 'A fast roof measurement: every building on the property outlined on an aerial photo, with its squares at an estimated pitch and at every pitch from 1/12 to 12/12, including 10%, 12% and 15% waste.'),
      ('How fast is a Rapid Squares report?', 'Under 30 minutes from the order.'),
      ('How is Rapid Squares different from a Premium Residential report?', 'Rapid Squares gives squares, pitch, footprint and perimeter for each building on one page. A Premium Residential report adds every edge length, length, area and pitch diagrams, and an optional Xactimate ESX file.'),
      ('Does Rapid Squares include an Xactimate (ESX) file?', 'No. The ESX file comes with Premium Residential and Commercial reports.'),
      ('How much does Rapid Squares cost?', 'Rapid Squares is $8, or $5 with a subscription.'),
      ('What if I know the real pitch?', 'Use that row of the table: every report lists the squares at every pitch from 1/12 to 12/12, not only the estimated one.'),
    ]),
  dict(
    slug='commercial-roof-report', blurb='Flat and low-slope roofs, every building', id='commercial', name='Commercial Roof Measurement Report', short='Commercial',
    price=3000, sub=2500, img='commercial-summary.jpg', og='og-commercial.jpg', sample='samples/commercial-roof-report-sample.pdf',
    title='Commercial Roof Measurement Report | Rapid Squares',
    desc='Aerial measurements for flat and low-slope commercial roofs: area, squares, parapet walls, edges, a waste table and diagrams for every building.',
    eyebrow='Commercial roof report',
    h1='Commercial roof measurements for flat and low-slope roofs',
    lede='Every building on the property measured from above: total area and squares, parapet walls, edges and flashing, the pitch of every section, and a waste factor table, with labeled diagrams. For bids on warehouses, retail, offices, churches and multi-family buildings.',
    facts=[('Delivered', 'Usually in about 8 hours'), ('Files', 'PDF report, with an Xactimate ESX for <span data-price="esx">$5</span> more'), ('Measures', 'Every building on the property'), ('Coverage', 'United States and Canada')],
    features=[
      ('commercial-summary.jpg', 'Commercial report summary: total roof area, squares, edges, parapet and the waste factor table', 'Area, squares and waste at a glance',
       'The report summary gives the totals you bid from, and the squares to order at every waste allowance.',
       ['Total roof area in square feet and squares', 'Eaves, parapet walls and wall flashing with their lengths', 'Flat and low-slope sections by pitch', 'Waste factor table from 0% to 24%']),
      ('commercial-overview.jpg', 'Aerial photo of a commercial building with a flat roof', 'Aerial view of the whole property',
       'A high-resolution aerial photo shows the property as it was measured, rooftop equipment and all.',
       ['Top-down aerial image', 'Your company\'s branding on every page', 'Address and report date on every page']),
      ('commercial-structure.jpg', 'Structure page with the roof plan, edge measurements and pitch breakdown', 'A page for each building',
       'Each structure has its own roof plan with edge measurements, total area and pitch breakdown, plus length, area and pitch diagrams.',
       ['Roof plan for each building', 'Length, area and pitch diagrams', 'Edge counts and total edge length']),
    ],
    steps=[('Search the address', 'Type the address and pick it from the suggestions.'), ('Confirm the property', 'Check the pin. Every building on the property is measured.'), ('Get the report', 'It\'s emailed to you, PDF attached, usually in about 8 hours.')],
    prose=['Flat and low-slope roofs are measured by area and by their edges: parapet walls, eaves and wall flashing drive the bid as much as the field does. Commercial reports measure every building on the property, so a campus or a strip center is one order.'],
    faq=[
      ('How long does a commercial roof report take?', 'Commercial reports are usually ready in about 8 hours. Large or complex properties can take longer.'),
      ('Can you measure flat roofs?', 'Yes. Commercial reports are built for flat and low-slope roofs, including parapet walls, and list flat sections separately in the pitch breakdown.'),
      ('Which buildings are measured?', 'Every building on the property.'),
      ('Can I get an Xactimate (ESX) file for a commercial roof?', 'Yes, for $5 more, when you order or afterwards.'),
      ('How much does a commercial roof report cost?', 'A Commercial report is $30, or $25 with a subscription.'),
    ]),
  dict(
    slug='hail-storm-report', blurb='Hail, wind and tornado history, 5 PDFs', id='storm_report', name='Hail and Storm History Report', short='Storm Report',
    price=500, sub=0, img='storm-hail-verification.jpg', og='og-storm.jpg', sample='samples/storm-report-sample.pdf',
    title='Hail and Storm History Report by Address | Rapid Squares',
    desc='Five years of hail, wind and tornado history for any address in seconds: hail size by distance, a date of loss check and 5 PDFs. Free with a subscription.',
    eyebrow='Storm Report',
    h1='Hail and storm history for any address, in seconds',
    lede='Five years of hail, wind and tornado history at the property and within 1, 3 and 5 miles: hail size by date, the strongest wind, the closest tornado, a damage-chance rating, and a check of your date of loss. Five PDFs, ready in seconds, for adjusters, roofers and homeowners.',
    facts=[('Delivered', 'In seconds'), ('Files', '5 PDFs: homeowner summary, hail, wind, date of loss, weather history'), ('Period', 'The last 5 years'), ('Coverage', 'United States and Canada')],
    features=[
      ('storm-hail-verification.jpg', 'Hail verification page: hail size at the property and within 1, 3 and 5 miles for every hail date, with confidence', 'Hail verification',
       'Every date hail fell at or near the property, by distance, with the largest report and how confident the data is.',
       ['Hail size at the property and within 1, 3 and 5 miles', 'The largest nearby report and its distance', 'Confidence for every date, and your date of loss highlighted']),
      ('storm-date-of-loss.jpg', 'Date of loss page: what was recorded on the claimed date by distance, with the hail swath map', 'Date of loss check',
       'Enter a date of loss when you download, and get a page that shows what was recorded that day, by distance, on a map.',
       ['Radar hail, ground reports, wind gusts and warnings for that day', 'The nearest storm days before and after', 'Add the claim number, insured name and notes to each PDF']),
      ('storm-wind-verification.jpg', 'Wind verification page: strongest wind within 1, 3 and 5 miles, stations, warnings and tornadoes', 'Wind and tornado history',
       'Severe wind and tornadoes near the property, from damage surveys, weather stations and warnings.',
       ['Strongest wind within 1, 3 and 5 miles', 'Nearby weather stations and warnings', 'Tornado distance and EF rating']),
    ],
    steps=[('Search the address', 'Type the address and pick it from the suggestions.'), ('Order the Storm Report', 'There\'s nothing to measure, so it\'s ready in seconds.'), ('Download the PDFs', 'Add a date of loss, claim number or notes to any of the five PDFs when you download it.')],
    prose=['Storm Reports use public weather records from NOAA and the National Weather Service: radar-estimated hail, storm reports, damage surveys, weather stations and warnings. The damage-chance rating is based on the weather only; an inspection confirms damage.'],
    faq=[
      ('How do I check if hail hit my address?', 'Order a Storm Report for the address. It lists every date in the last five years with hail at the property or within 1, 3 and 5 miles, with the hail size and how confident the data is.'),
      ('What PDFs come with a Storm Report?', 'Five: a plain-English Homeowner Storm Summary, Hail Verification, Wind Verification, Date of Loss, and a full Weather History.'),
      ('Can I verify a date of loss?', 'Yes. Enter the date when you download the Date of Loss PDF and it shows what was recorded that day at the property and within 1, 3 and 5 miles, with the nearest storm days before and after.'),
      ('Where does the storm data come from?', 'Public weather records from NOAA and the National Weather Service, including radar-estimated hail, storm reports, damage surveys, weather stations and warnings.'),
      ('How much does a Storm Report cost?', 'A Storm Report is $5, and free with a subscription.'),
      ('Which areas are covered?', 'The United States and Canada. Canadian reports use radar hail and weather stations, and say so on the report.'),
    ]),
]

def cta(p): return 'Order a ' + p['short'] + ('' if p['short'].endswith('Report') else ' report')

def money(c): return 'Free' if not c else '$' + ('%.2f' % (c / 100)).replace('.00', '')

def top(title, desc, url, og_title, og, ld, order='order.html', og_type='product'):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="{og_type}">
<meta property="og:site_name" content="Rapid Squares">
<meta property="og:title" content="{e(og_title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/img/{og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<meta name="theme-color" content="#16222C">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="stylesheet" href="styles.css">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body data-page="landing" class="lp">

<header class="topbar lp-top">
  <a class="brand" href="index.html" aria-label="Rapid Squares home">
    {LOGO}
    <span class="brand-name">Rapid Squares</span>
    <span class="brand-sub">Aerial Roof Reports</span>
  </a>
  <nav class="lp-nav" aria-label="Primary">
    <details class="lp-menu">
      <summary>Reports</summary>
      <div class="lp-menu-list">
        <a href="residential-roof-report"><b>Premium Residential</b><span>Full roof report in under 2 hours</span></a>
        <a href="rapid-squares"><b>Rapid Squares</b><span>Squares at every pitch in under 30 minutes</span></a>
        <a href="commercial-roof-report"><b>Commercial</b><span>Flat and low-slope roofs</span></a>
        <a href="hail-storm-report"><b>Storm Report</b><span>Hail and wind history in seconds</span></a>
        <a href="pricing" class="lp-menu-all">All reports and prices</a>
      </div>
    </details>
    <a href="pricing" class="lp-hide-sm">Pricing</a>
    <a href="#faq" class="lp-hide-sm">FAQ</a>
    <a href="signin.html" id="lp-account">Sign in</a>
    <a href="{order}" class="nav-cta">Order a report</a>
  </nav>
</header>

'''

def bottom():
    return f'''
<footer class="lp-foot">
  <div class="lp-wrap lp-foot-in">
    <span>© <span id="lp-year">2026</span> Rapid Squares</span>
    <nav aria-label="Footer">
      {''.join(f'<a href="{q["slug"]}">{e(q["short"])}</a>' for q in PAGES)}
      <a href="pricing">Pricing</a>
      <a href="order.html">Order a report</a>
      <a href="signin.html">Sign in</a>
      <a href="index.html#contact">Contact</a>
    </nav>
  </div>
</footer>

<script src="runtime-config.js"></script>
<script src="config.js"></script>
<script src="api.js"></script>
<script src="auth.js"></script>
<script src="report-page.js"></script>
<script src="menu.js"></script>
</body>
</html>
'''

def page(p):
    url = f'{BASE}/{p["slug"]}'
    others = [q for q in PAGES if q is not p]
    ld = [
      {'@context': 'https://schema.org', '@type': 'Product', 'name': p['name'], 'description': p['desc'], 'image': [f'{BASE}/img/{p["img"]}', f'{BASE}/img/{p["og"]}'],
       'brand': {'@type': 'Brand', 'name': 'Rapid Squares'}, 'url': url, 'category': 'Roof measurement report',
       'offers': {'@type': 'Offer', 'price': '%.2f' % (p['price'] / 100), 'priceCurrency': 'USD', 'availability': 'https://schema.org/InStock', 'url': f'{BASE}/order.html?report={p["id"]}', 'seller': {'@type': 'Organization', 'name': 'Rapid Squares'}}},
      {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': BASE + '/'},
        {'@type': 'ListItem', 'position': 2, 'name': 'Reports', 'item': BASE + '/#reports'},
        {'@type': 'ListItem', 'position': 3, 'name': p['short'], 'item': url}]},
      {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in p['faq']]},
    ]
    feats = ''.join(f'''
      <div class="pp-feature">
        <figure class="pp-shot"><img src="img/{f[0]}" alt="{e(f[1])}" loading="lazy" decoding="async"></figure>
        <div>
          <h3>{e(f[2])}</h3>
          <p>{e(f[3])}</p>
          <ul>{''.join(f'<li>{e(x)}</li>' for x in f[4])}</ul>
        </div>
      </div>''' for f in p['features'])
    rows = ''.join(f'''
            <tr{' class="pp-here"' if q is p else ''}><th scope="row">{'<a href="' + q['slug'] + '">' + e(q['short']) + '</a>' if q is not p else e(q['short'])}</th><td>{e(dict(q['facts'])['Delivered'])}</td><td><span data-price="{q['id']}">{money(q['price'])}</span></td><td><span data-price="{q['id']}" data-sub>{money(q['sub'])}</span></td></tr>''' for q in PAGES)
    free = '' if p['id'] != 'premium_residential' else '\n        <p class="lp-small" data-free-offer>New accounts get their first <b><span data-free-n>3</span> Premium reports free</b>. <a href="signin.html?step=signup&amp;next=orders.html" style="color: inherit;">Create a free account</a></p>'
    faq_html = ''.join(f'''
        <details>
          <summary>{e(q)}</summary>
          <p>{e(a)}</p>
        </details>''' for q, a in p['faq'])
    shot_w, shot_h = {'residential-summary.jpg': (1200, 988), 'rapid-squares-report.jpg': (1200, 1374), 'commercial-summary.jpg': (1200, 715), 'storm-hail-verification.jpg': (1200, 1374)}[p['img']]
    return top(p['title'], p['desc'], url, p['h1'], p['og'], ld, f"order.html?report={p['id']}") + f'''<main>
  <section class="lp-hero" aria-labelledby="pp-h1">
    <div class="lp-wrap lp-hero-in">
      <div class="lp-hero-copy">
        <p class="pp-crumbs"><a href="index.html">Home</a> › <a href="index.html#reports">Reports</a> › {e(p['short'])}</p>
        <p class="lp-eyebrow">{e(p['eyebrow'])}</p>
        <h1 id="pp-h1">{e(p['h1'])}</h1>
        <p class="lp-lede">{e(p['lede'])}</p>
        <ul class="pp-prices" aria-label="Price">
          <li><span>Price</span><b data-price="{p['id']}">{money(p['price'])}</b></li>
          <li class="pp-sub"><span>With a subscription</span><b data-price="{p['id']}" data-sub>{money(p['sub'])}</b></li>
          <li><span>Delivered in</span><b>{e(dict(p['facts'])['Delivered'].replace('In ', '').replace('Usually in ', '~').replace('about ', ''))}</b></li>
        </ul>
        <div class="pp-cta">
          <a href="order.html?report={p['id']}" class="btn btn-primary">{e(cta(p))}</a>
          <a href="{p['sample']}" class="pp-sample" target="_blank" rel="noopener">See a sample (PDF)</a>
        </div>{free}
      </div>
      <figure class="lp-hero-art">
        <a href="{p['sample']}" target="_blank" rel="noopener"><img src="img/{p['img']}" width="{shot_w}" height="{shot_h}" alt="Sample {e(p['name'])}" fetchpriority="high"></a>
        <figcaption><a href="{p['sample']}" target="_blank" rel="noopener">Open the full sample report (PDF)</a></figcaption>
      </figure>
    </div>
  </section>

  <section class="lp-section" aria-labelledby="facts-h">
    <div class="lp-wrap">
      <h2 id="facts-h" class="sr">At a glance</h2>
      <dl class="pp-facts">{''.join(f'<div><dt>{e(k)}</dt><dd>{v}</dd></div>' for k, v in p['facts'])}</dl>
    </div>
  </section>

  <section class="lp-section lp-alt" aria-labelledby="inside-h">
    <div class="lp-wrap">
      <p class="lp-eyebrow">What's in the report</p>
      <h2 id="inside-h">What you get with {e(p['short'])}</h2>{feats}
    </div>
  </section>

  <section class="lp-section" aria-labelledby="how-h">
    <div class="lp-wrap">
      <p class="lp-eyebrow">How it works</p>
      <h2 id="how-h">Order in under a minute</h2>
      <ol class="pp-steps">{''.join(f'<li><b>{e(t)}</b>{e(d)}</li>' for t, d in p['steps'])}</ol>
      <div class="pp-prose" style="margin-top: 32px;">{''.join(f'<p>{e(x)}</p>' for x in p['prose'])}</div>
    </div>
  </section>

  <section class="lp-section lp-alt" aria-labelledby="compare-h">
    <div class="lp-wrap">
      <p class="lp-eyebrow">Compare</p>
      <h2 id="compare-h">Our reports</h2>
      <div class="table-wrap lp-pt-wrap">
        <table class="pp-compare">
          <thead><tr><th scope="col">Report</th><th scope="col">Delivered</th><th scope="col">Price</th><th scope="col">With a subscription</th></tr></thead>
          <tbody>{rows}
          </tbody>
        </table>
      </div>
      <p class="lp-pt-foot">A subscription is $100 a month or $1,000 a year, with a 30-day free trial. <a href="account.html#billing">Start a free trial</a></p>
    </div>
  </section>

  <section id="faq" class="lp-section" aria-labelledby="faq-h">
    <div class="lp-wrap lp-narrow">
      <p class="lp-eyebrow">FAQ</p>
      <h2 id="faq-h">{e(p['short'])} questions</h2>
      <div class="lp-faq">{faq_html}
      </div>
    </div>
  </section>

  <section class="lp-section pp-band" aria-labelledby="band-h">
    <div class="lp-wrap pp-band-in">
      <div>
        <h2 id="band-h">Ready to order?</h2>
        <p>Search the address, confirm the roof, and the report comes to your inbox.</p>
      </div>
      <a href="order.html?report={p['id']}" class="btn btn-primary">{e(cta(p))}</a>
    </div>
  </section>
</main>
''' + bottom()


# ---------- Pricing page ----------
PLANS = dict(monthly=10000, yearly=100000, trial_days=30, free_reports=3, esx=500)
PRICING_FAQ = [
  ('How much does a roof report cost?', 'A Premium Residential report is $12, Rapid Squares is $8, a Commercial report is $30 and a Storm Report is $5. With a subscription they are $7, $5, $25 and free.'),
  ('Is there a free trial?', 'Yes. Every company can try a subscription free for 30 days, with subscriber prices on every report from the first day. A card is needed to start, and you can cancel any time before the trial ends.'),
  ('How much is the subscription?', '$100 a month, or $1,000 a year, which saves $200. It covers your whole team: everyone on the account orders at subscriber prices.'),
  ('Do new accounts get free reports?', 'Yes. Create an account and your first Premium Residential reports are free.'),
  ('Is the Xactimate ESX file extra?', 'Yes, $5 per report, on Premium Residential and Commercial reports. Add it when you order or later from the report page.'),
  ('What if a roof can\'t be measured?', 'You\'re refunded automatically, and we email you to say why.'),
  ('Are there contracts or minimums?', 'No. Pay per report with no account at all, or subscribe month to month or by the year and cancel any time.'),
]

def pricing_page():
    url = f'{BASE}/pricing'
    rows = ''.join(f"""
            <tr><th scope="row"><a href="{q['slug']}">{e(q['short'])}</a><span>{e(q['blurb'])}</span></th><td>{e(dict(q['facts'])['Delivered'])}</td><td><span data-price="{q['id']}">{money(q['price'])}</span></td><td><b data-price="{q['id']}" data-sub>{money(q['sub'])}</b></td><td><a href="order.html?report={q['id']}" class="btn btn-outline">Order</a></td></tr>""" for q in PAGES)
    ld = [
      {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': BASE + '/'},
        {'@type': 'ListItem', 'position': 2, 'name': 'Pricing', 'item': url}]},
      {'@context': 'https://schema.org', '@type': 'OfferCatalog', 'name': 'Rapid Squares pricing', 'url': url, 'itemListElement': [
        {'@type': 'Offer', 'name': q['name'], 'price': '%.2f' % (q['price'] / 100), 'priceCurrency': 'USD', 'url': f"{BASE}/{q['slug']}"} for q in PAGES] + [
        {'@type': 'Offer', 'name': 'Rapid Squares subscription, monthly', 'price': '%.2f' % (PLANS['monthly'] / 100), 'priceCurrency': 'USD',
         'priceSpecification': {'@type': 'UnitPriceSpecification', 'price': '%.2f' % (PLANS['monthly'] / 100), 'priceCurrency': 'USD', 'billingDuration': 'P1M'}},
        {'@type': 'Offer', 'name': 'Rapid Squares subscription, yearly', 'price': '%.2f' % (PLANS['yearly'] / 100), 'priceCurrency': 'USD',
         'priceSpecification': {'@type': 'UnitPriceSpecification', 'price': '%.2f' % (PLANS['yearly'] / 100), 'priceCurrency': 'USD', 'billingDuration': 'P1Y'}}]},
      {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in PRICING_FAQ]},
    ]
    faq_html = ''.join(f"""
        <details>
          <summary>{e(q)}</summary>
          <p>{e(a)}</p>
        </details>""" for q, a in PRICING_FAQ)
    return top('Roof Report Pricing: Pay Per Report or Subscribe | Rapid Squares',
               'Roof report prices: Premium Residential $12, Rapid Squares $8, Commercial $30, Storm Report $5. Subscribe from $100 a month for lower prices, with a 30-day free trial.',
               url, 'Roof report pricing', 'og-residential.jpg', ld, og_type='website') + f"""<main>
  <section class="lp-hero pr-hero" aria-labelledby="pr-h1">
    <div class="lp-wrap">
      <p class="pp-crumbs"><a href="index.html">Home</a> › Pricing</p>
      <h1 id="pr-h1">Roof report pricing</h1>
      <p class="lp-lede">Pay for each report as you go, with no account needed, or subscribe for lower prices on every report and free Storm Reports. Every subscription starts with <b data-trial-days>{PLANS['trial_days']}</b> days free.</p>
      <p class="lp-small" data-free-offer>New accounts get their first <b><span data-free-n>{PLANS['free_reports']}</span> Premium reports free</b>. <a href="signin.html?step=signup&amp;next=orders.html" style="color: inherit;">Create a free account</a></p>
    </div>
  </section>

  <section class="lp-section" aria-labelledby="reports-h">
    <div class="lp-wrap">
      <p class="lp-eyebrow">Reports</p>
      <h2 id="reports-h">Price per report</h2>
      <div class="table-wrap lp-pt-wrap">
        <table class="pr-table">
          <thead><tr><th scope="col">Report</th><th scope="col">Delivered</th><th scope="col">Price</th><th scope="col">With a subscription</th><th scope="col"><span class="sr">Order</span></th></tr></thead>
          <tbody>{rows}
          </tbody>
        </table>
      </div>
      <p class="lp-pt-foot">Add the Xactimate (ESX) file to a Premium Residential or Commercial report for <span data-price="esx">{money(PLANS['esx'])}</span>. Prices are in US dollars.</p>
    </div>
  </section>

  <section class="lp-section lp-alt" aria-labelledby="plans-h">
    <div class="lp-wrap">
      <p class="lp-eyebrow">Subscription</p>
      <h2 id="plans-h">Lower prices on every report</h2>
      <div class="pr-plans">
        <div class="pr-plan">
          <h3>Monthly</h3>
          <p class="pr-price"><b data-plan="monthly">${PLANS['monthly'] // 100:,}</b>/month</p>
          <p class="pr-trial"><span data-trial-days>{PLANS['trial_days']}</span> days free</p>
          <a href="account.html#billing" class="btn btn-outline">Start free trial</a>
        </div>
        <div class="pr-plan pr-plan-best">
          <h3>Yearly <span class="lp-pt-tag lp-plan-save" data-plan-save>Save $200</span></h3>
          <p class="pr-price"><b data-plan="yearly">${PLANS['yearly'] // 100:,}</b>/year</p>
          <p class="pr-trial"><span data-trial-days>{PLANS['trial_days']}</span> days free</p>
          <a href="account.html#billing" class="btn btn-primary">Start free trial</a>
        </div>
        <ul class="pr-includes">
          <li>Subscriber prices on every report</li>
          <li>Storm Reports free</li>
          <li>One subscription covers your whole team</li>
          <li>Instant Squares included when it launches</li>
          <li>Cancel any time</li>
        </ul>
      </div>
      <div class="pp-prose" style="margin-top: 28px;">
        <p>A subscription pays for itself on volume. It saves $5 on every Premium Residential report and every Storm Report, $3 on Rapid Squares and $5 on Commercial, so a team ordering around 20 Premium reports a month comes out ahead on the monthly plan, and fewer on the yearly one.</p>
      </div>
    </div>
  </section>

  <section id="faq" class="lp-section" aria-labelledby="faq-h">
    <div class="lp-wrap lp-narrow">
      <p class="lp-eyebrow">FAQ</p>
      <h2 id="faq-h">Pricing questions</h2>
      <div class="lp-faq">{faq_html}
      </div>
    </div>
  </section>

  <section class="lp-section pp-band" aria-labelledby="band-h">
    <div class="lp-wrap pp-band-in">
      <div>
        <h2 id="band-h">Order your first report</h2>
        <p>Search the address, confirm the roof, and the report comes to your inbox.</p>
      </div>
      <a href="order.html" class="btn btn-primary">Order a report</a>
    </div>
  </section>
</main>
""" + bottom()

for p in PAGES:
    open(f'{SITE}/{p["slug"]}.html', 'w').write(page(p))
    print('wrote', p['slug'] + '.html')
open(f'{SITE}/pricing.html', 'w').write(pricing_page())
print('wrote pricing.html')
