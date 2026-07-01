# BabyLog

A tiny, local-first-ish PWA for two people to log newborn care events into a Google
Sheet, hosted at **https://kai.baussart.me** (GitHub Pages). Two moving parts:

1. **Backend** — a small Google Apps Script web app (`backend/`) that reads/writes one
   Sheet tab, gated by a shared token.
2. **Frontend** — a single static PWA (`index.html` + `manifest.webmanifest` + `sw.js` +
   icons), installable to the iOS home screen.

No native app, no database server, no build tooling. Corrections are made by hand-editing
the Sheet — that's a feature.

---

## Data model

One sheet tab named `log`, header row 1:

```
id | timestamp | date | type | subtype | value | unit | note
```

- **id** — UUID, generated server-side.
- **timestamp** — ISO 8601 of when the event happened (for feeds: the session **start**).
- **date** — `yyyy-MM-dd` in Europe/Paris (server-generated).
- **type** — `feed` | `pee` | `poop` | `soin` | `temp`.
- **subtype** — `soin`: `nose` | `eyes` | `navel` | `other`; `feed` source:
  `left-boob` | `right-boob` (extensible, e.g. `mom-milk-bottle` | `industrial-milk-bottle`).
- **value / unit** — `temp` → number + `C`; `feed` → **duration in minutes** + `min`.
- **note** — free text, optional.

Append-only. Feed **end** time is derived in the app as `start + duration`.

---

## Setup — do these in order

### 1. Google Sheet + Apps Script backend

1. Create a Google Sheet. Rename the first tab to `log`. Put the header row above in row 1.
2. **Extensions → Apps Script.** Paste `backend/Code.gs`. In Project Settings, enable
   "Show `appsscript.json`", then replace the manifest with `backend/appsscript.json`
   (sets timezone to Europe/Paris — required for correct `date`/`today`).
3. **Project Settings → Script Properties →** add `TOKEN` = a long random string
   (e.g. a UUID). This is the value you share manually with your partner.
4. **Deploy → New deployment → Web app.** Execute as **Me**, Who has access **Anyone**.
   Deploy and copy the `/exec` URL.

### 2. Smoke-test the backend (before touching the frontend)

```bash
EXEC_URL="https://script.google.com/macros/s/XXXX/exec"
TOKEN="your-token"

# write  (no -X POST: Apps Script 302-redirects; --data posts then follows as GET)
curl -L "$EXEC_URL" -H "Content-Type: text/plain" \
  --data "{\"token\":\"$TOKEN\",\"type\":\"pee\"}"             # -> {"ok":true}

# read today
curl -L "$EXEC_URL?token=$TOKEN&date=today"                    # -> today's rows

# read a range (used by Insights)
curl -L "$EXEC_URL?token=$TOKEN&days=14"                       # -> last 14 days

# wrong token is rejected
curl -L "$EXEC_URL?token=WRONG&date=today"                     # -> {"ok":false,"error":"unauthorized"}
```

### 3. Wire the frontend

1. Open `index.html`, set the `API_URL` constant to your `/exec` URL.
2. Do the same for the placeholder in `sw.js` (the `PASTE_DEPLOYMENT_EXEC_URL_HERE`
   guard that stops the service worker from caching API traffic).

### 4. Host on GitHub Pages at kai.baussart.me

1. Create a GitHub repo and push these files to `main` (repo root).
2. **Repo → Settings → Pages:** Source = *Deploy from a branch*, Branch = `main` / `/root`.
3. Set **Custom domain** to `kai.baussart.me` (the committed `CNAME` file already holds it).
4. **OVH DNS** (baussart.me zone) → add a record:
   - Type: `CNAME`
   - Subdomain: `kai`
   - Target: `<your-github-username>.github.io.`  (note the trailing dot)
5. Wait for DNS to propagate; GitHub auto-provisions HTTPS. Enable **Enforce HTTPS**.
6. Open `https://kai.baussart.me` on both phones, enter the token, **Add to Home Screen**.

---

## Access & security notes

- **App-token only.** GitHub Pages is static hosting with no server in front, so the page
  load itself cannot be gated. The HTML shell is publicly fetchable but contains **no
  secrets and no data** — every read/write requires the shared token, entered once per
  device and stored in `localStorage`. Use **settings → clear token** to remove it.
- The token travels in the GET query string for reads; fine for a personal tool, but it
  can appear in server logs. Don't lower this to no-token.

## Feeding sessions

Feed is a **Start / Stop** timer. Tap **Start feed**, tap **Stop feed** when done — one
`feed` row is written with the duration in minutes. The in-progress state is kept in
`localStorage` and the elapsed time is recomputed from the start timestamp, so it survives
the phone sleeping or the app closing (reopen shows "feeding since …"). You can adjust the
start time or **discard** an accidental session. Note: an in-progress feed is only visible
on the device that started it.

## Historical data migration

Reshape existing data into the flat `log` schema and paste/import it below the header row.
A migration script lives in `scripts/` once the source CSV format is known
(maps source rows → long `log` rows, generating `id`, ISO `timestamp`, Europe/Paris `date`).

## Files

```
index.html              PWA: UI, styles, client calls, Insights (Chart.js via CDN)
manifest.webmanifest    installability
sw.js                   caches app shell + Chart.js (never the API)
icon-192.png / -512.png app icons
CNAME                   kai.baussart.me (GitHub Pages custom domain)
backend/Code.gs         doPost (append) + doGet (today / date / days=N / from-to)
backend/appsscript.json Europe/Paris timezone + web app config
```
