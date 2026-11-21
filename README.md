# PestLeadWire landing page

https://pestleadwire.buusystems.com, the public page for PestLeadWire (operated by BUU Systems LLC).
It sells the weekly lead lists that the PestLeadWire app (`buusystems/pestleadwire-app`,
app.pestleadwire.buusystems.com) builds: businesses cited for pest problems on public health
inspections, sent to pest control companies every Monday.

Static site served by GitHub Pages from `main`: `index.html`, `styles.css`, `app.js`, `data/snapshot.json`.

## What the page shows

- **Near you:** a visitor types a ZIP and sees how many businesses were cited within 10 miles over the last
  14 days, plus the three closest as rows of the list (name, miles, type, date, what the inspector found;
  phone and street hidden). ZIPs that no feed reaches get a "not covered yet" message.
- **Coverage:** every market and state the app covers, with this fortnight's counts.
- **Pricing:** free sample of 10 businesses (the app's sample step), then the 4-week pilot at $40/week (the app's `DEFAULT_PILOT_PRICE`).
- **Free sample form:** opens the visitor's email app addressed to pestleadwire@gmail.com.

No record ids or portal links are shown, and the page never claims a citation means a business asked for
pest control (same rules as the app's client emails).

## Refreshing the numbers

`data/snapshot.json` is built from the app's own feed code (free public data, no Google calls):

    python3 scripts/snapshot.py --app ~/code/pestleadwire-app   # ~15 s
    git commit -am "Snapshot $(date +%F)" && git push

It writes per-market counts and, for every ZIP within reach of a feed, the count within 10 miles and
the three nearest examples. When the app adds markets, re-run it: coverage on the page follows.

## Run locally

    python3 -m http.server 8761      # then open http://localhost:8761/?zip=60614
