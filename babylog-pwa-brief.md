# BabyLog — Build Brief

A tiny, local-first-ish PWA for two people (me + partner) to log newborn care events into a Google Sheet. No native app, no paid Apple account, no database server. Two moving parts:

1. **Backend** — a ~30-line Google Apps Script web app that reads/writes one Sheet, gated by a shared token.
2. **Frontend** — a single static PWA (installable to iOS home screen) with big tap buttons, a temperature field, and a "today so far" summary.

Latency does not matter. Correctness, simplicity, and being able to hand-edit historical rows in the Sheet matter.

---

## Why this shape (context for the agent — do not re-litigate)

- The Google Sheets API cannot do a "shared token → write a row" flow. API keys only read *public* sheets; any write needs OAuth or a service account. A service-account private key must never ship inside a public PWA.
- An Apps Script web app deployed "execute as me / anyone with the link" holds the credentials server-side (runs as the sheet owner), so the client only needs a shared token. This is the minimal correct design, not an extra layer.
- The PWA is pure static files; it can be hosted anywhere (Vercel Hobby, GitHub Pages, Netlify). Hosting choice is not important.

---

## Data model

One sheet tab named `log`, with this header row (row 1):

```
id | timestamp | date | type | subtype | value | unit | note
```

- **id** — UUID, generated server-side.
- **timestamp** — ISO 8601 string of when the event happened.
- **date** — `yyyy-MM-dd` in Europe/Paris, for easy daily filtering and hand-editing.
- **type** — one of: `feed`, `pee`, `poop`, `soin`, `temp`.
- **subtype** — only used by `soin`: `nose`, `eyes`, `navel`, `other`. Empty otherwise.
- **value** — only used by `temp` (e.g. `37.2`) and optionally `feed` (ml). Empty otherwise.
- **unit** — `C` for temp, `ml` for feed if used. Empty otherwise.
- **note** — free text, optional.

Append-only. Corrections are done by editing the Sheet directly. That's a feature.

---

## Part A — Backend (Google Apps Script)

Create the script bound to the Sheet (Extensions → Apps Script). Deliver `Code.gs` and `appsscript.json`.

### `Code.gs`

```javascript
const SHEET_NAME = 'log';

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN');
}
function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if ((e.parameter.token || '') !== getToken_()) {
    return json_({ ok: false, error: 'unauthorized' });
  }
  const tz = Session.getScriptTimeZone();
  const wantDate = e.parameter.date === 'today'
    ? Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')
    : (e.parameter.date || null);

  const values = sheet_().getDataRange().getValues();
  values.shift(); // drop header
  const rows = values
    .filter(r => r[0] !== '')
    .filter(r => !wantDate || r[2] === wantDate)
    .map(r => ({
      id: r[0], timestamp: r[1], date: r[2], type: r[3],
      subtype: r[4], value: r[5], unit: r[6], note: r[7]
    }));
  return json_({ ok: true, rows });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'bad json' }); }

  if ((body.token || '') !== getToken_()) {
    return json_({ ok: false, error: 'unauthorized' });
  }

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const when = body.timestamp ? new Date(body.timestamp) : now;

  const row = [
    Utilities.getUuid(),
    when.toISOString(),
    Utilities.formatDate(when, tz, 'yyyy-MM-dd'),
    body.type || '',
    body.subtype || '',
    (body.value != null && body.value !== '') ? body.value : '',
    body.unit || '',
    body.note || ''
  ];
  sheet_().appendRow(row);
  return json_({ ok: true });
}
```

### `appsscript.json`

Set the timezone so `date` and "today" are correct:

```json
{
  "timeZone": "Europe/Paris",
  "dependencies": {},
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

### Backend notes / gotchas

- **CORS / preflight:** the client must POST as `Content-Type: text/plain` (not `application/json`) so the browser treats it as a "simple request" and skips the preflight OPTIONS, which Apps Script can't answer. The script parses the raw body as JSON itself.
- **Redirects:** Apps Script web apps 302 to `script.googleusercontent.com`. Default `fetch` follows redirects, so leave `redirect` at its default. Don't set custom headers on the client (that would re-trigger preflight).
- **Token in GET query** is fine for a personal tool but can appear in logs; acceptable here. Do not lower this to no-token.
- **Concurrency:** with two users the odds of a same-millisecond append collision are negligible; do **not** add LockService for v1. If it ever matters, wrap the append in `LockService.getScriptLock()`.

---

## Part B — Frontend (PWA)

A single-page installable PWA. Files: `index.html` (inline CSS + JS is fine), `manifest.webmanifest`, `sw.js`, and `icon-192.png` / `icon-512.png`.

### Config & auth

- A single constant `API_URL` = the deployed web-app `/exec` URL.
- On first load, if no token in `localStorage`, show a full-screen token prompt. Store the entered token in `localStorage` under `babylog_token`. (Real hosted PWA, so `localStorage` is correct and expected here.)
- A small "settings" affordance to re-enter/clear the token.

### Client calls

```javascript
const API_URL = "PASTE_DEPLOYMENT_EXEC_URL_HERE";
const getToken = () => localStorage.getItem("babylog_token") || "";

async function logEvent(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, token: getToken() }),
  });
  return res.json();
}

async function fetchToday() {
  const url = `${API_URL}?token=${encodeURIComponent(getToken())}&date=today`;
  const res = await fetch(url);
  return res.json();
}
```

### UI

Main screen, above the fold, thumb-reachable:

- **Big tap buttons** (fire-and-log, one tap = one event, show a brief confirmation):
  - `Feed` → `{ type: "feed" }`  (optional: long-press to add ml into `value`/`unit:"ml"`)
  - `Pee` → `{ type: "pee" }`
  - `Poop` → `{ type: "poop" }`
- **Soin**: a small row of chips `Nose · Eyes · Navel · Other`, each logs `{ type: "soin", subtype: <chip> }`.
- **Temperature**: a numeric input + `Save` → `{ type: "temp", value: <n>, unit: "C" }`. Step 0.1, sane range 34–42.
- **Today so far** summary (calls `fetchToday()` on load and after each write):
  - counts: feeds, pees, poops today
  - time since last feed (from most recent `feed` timestamp)
  - today's temp(s)
  - soins done today (list subtypes)
- Labels can be bilingual FR/EN or renamed freely — treat them as easily editable strings.

### Interaction details

- After any successful write, optimistically bump the local "today" counts, then refresh from `fetchToday()` to stay truthful.
- Show a small toast on success and on failure. On failure, keep the tap easy to retry — do not silently drop it.
- One-handed use at 3am is the design constraint: large targets, high contrast, no tiny controls, no accidental destructive actions.
- Optional (nice-to-have, not required for v1): queue failed writes in `localStorage` and flush on next load / `online` event.

### Design direction

Restrained, functional, Rams-ish / Swiss. Concretely:
- Monospace type (system mono stack is fine: `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace`).
- Near-neutral palette: paper/off-white background, near-black text, **one** restrained accent used sparingly for confirmations. No gradients, no decorative shadows.
- Generous whitespace, clear grid, obvious hit areas. Content over chrome. It should feel like an instrument, not an app store app.

### PWA installability

- `manifest.webmanifest` with `name`, `short_name` ("BabyLog"), `display: "standalone"`, `theme_color`, `background_color`, `start_url: "."`, and the two icons.
- Minimal `sw.js` that caches the app shell so it opens instantly and works if the network hiccups (data still needs network to sync). Register it from `index.html`.
- Link the manifest and set `<meta name="apple-mobile-web-app-capable" content="yes">` and an apple-touch-icon so iOS "Add to Home Screen" behaves.

---

## Setup steps (do these in order; the agent should produce a matching checklist in the repo README)

1. Create a Google Sheet. Rename the first tab to `log`. Put the header row in row 1 (see Data model).
2. Extensions → Apps Script. Paste `Code.gs`. Replace the manifest with `appsscript.json` above (enable "Show appsscript.json" in Project Settings if hidden).
3. Project Settings → Script Properties → add `TOKEN` = a random UUID (this is the value shared manually with my partner).
4. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access **Anyone** → Deploy. Copy the `/exec` URL.
5. **Test the backend with curl before touching the frontend** (see below).
6. Put the `/exec` URL into the PWA's `API_URL`.
7. Host the static files (Vercel/GitHub Pages/Netlify). Open the URL on both phones, enter the token when prompted, Add to Home Screen.

### curl smoke tests

```bash
# write
curl -L -X POST "$EXEC_URL" \
  -H "Content-Type: text/plain" \
  -d '{"token":"YOUR_TOKEN","type":"feed"}'

# read today
curl -L "$EXEC_URL?token=YOUR_TOKEN&date=today"
```

Both should return `{"ok":true,...}`. A wrong token must return `{"ok":false,"error":"unauthorized"}`.

---

## Acceptance criteria

- [ ] `curl` write appends a correctly-shaped row to the `log` tab; `id`, `timestamp`, and `date` are auto-filled; `date` is the Europe/Paris day.
- [ ] `curl` read with `date=today` returns only today's rows.
- [ ] Wrong/absent token is rejected for both read and write.
- [ ] From a browser, all five event types log successfully (no CORS error in console).
- [ ] "Today so far" shows correct counts, time-since-last-feed, and today's temp, and updates after each write.
- [ ] App installs to iOS home screen and launches standalone (no Safari chrome).
- [ ] A mistyped value can be fixed by editing the cell directly in Google Sheets and is reflected on next load.

---

## Build order (suggested for the agent)

1. Backend first: create `Code.gs` + `appsscript.json`, deploy, pass the curl tests.
2. Then the PWA shell + client calls; verify each event type against the live endpoint.
3. Then the "today" summary and the design pass.
4. Manifest + service worker + install last.

Keep it to the smallest thing that meets the acceptance criteria. Do not add auth beyond the shared token, analytics, build tooling, or a framework unless something genuinely requires it — plain HTML/CSS/JS is preferred.
