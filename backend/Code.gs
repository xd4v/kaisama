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

// Returns 'yyyy-MM-dd' for `date` in the script timezone (Europe/Paris).
function ymd_(date, tz) {
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

// Robust Date test. `instanceof Date` can be false for Date objects returned by
// Sheets (cross-realm), so check the internal [[Class]] tag instead.
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function doGet(e) {
  if ((e.parameter.token || '') !== getToken_()) {
    return json_({ ok: false, error: 'unauthorized' });
  }
  const tz = Session.getScriptTimeZone();

  // Date filtering. Supported (checked in order):
  //   date=today               -> only today's rows (Europe/Paris)
  //   date=yyyy-MM-dd          -> only that day
  //   days=N                   -> last N days inclusive (today .. today-(N-1))
  //   from=yyyy-MM-dd&to=...    -> inclusive range (either bound optional)
  //   (nothing)                -> all rows
  const today = ymd_(new Date(), tz);
  let wantDate = null;   // exact-day match
  let from = null;       // inclusive lower bound (yyyy-MM-dd string; lexicographic works)
  let to = null;         // inclusive upper bound

  if (e.parameter.date === 'today') {
    wantDate = today;
  } else if (e.parameter.date) {
    wantDate = e.parameter.date;
  } else if (e.parameter.days) {
    const n = Math.max(1, parseInt(e.parameter.days, 10) || 1);
    const start = new Date();
    start.setDate(start.getDate() - (n - 1));
    from = ymd_(start, tz);
    to = today;
  } else {
    if (e.parameter.from) from = e.parameter.from;
    if (e.parameter.to) to = e.parameter.to;
  }

  const values = sheet_().getDataRange().getValues();
  values.shift(); // drop header
  const rows = values
    .filter(r => r[0] !== '')
    // Sheets coerces the timestamp/date cells into Date objects; normalize them
    // back to strings FIRST (ISO for timestamp, Europe/Paris yyyy-MM-dd for date),
    // then filter — otherwise a Date never matches the yyyy-MM-dd filter string.
    .map(r => ({
      id: r[0],
      timestamp: isDate_(r[1]) ? r[1].toISOString() : String(r[1]),
      date: isDate_(r[2]) ? ymd_(r[2], tz) : String(r[2]),
      type: r[3], subtype: r[4], value: r[5], unit: r[6], note: r[7]
    }))
    .filter(o => {
      if (wantDate) return o.date === wantDate;
      if (from && o.date < from) return false;
      if (to && o.date > to) return false;
      return true;
    });
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
    ymd_(when, tz),
    body.type || '',
    body.subtype || '',
    (body.value != null && body.value !== '') ? body.value : '',
    body.unit || '',
    body.note || ''
  ];
  sheet_().appendRow(row);
  return json_({ ok: true });
}
