
// ── Calculate subscription expiry date ───────────────────────────
function calcExpiryDate(params) {
  var plan    = (params.plan    || '').toLowerCase();
  var billing = (params.billing || '').toLowerCase();
  var days    = 365; // default annual
  // Check billing field first, then fall back to plan name (e.g. "Solo (Monthly)")
  if (billing.indexOf('month') !== -1 || plan.indexOf('month') !== -1) days = 30;
  else if (billing.indexOf('annual') !== -1 || plan.indexOf('annual') !== -1) days = 365;
  var d = new Date(new Date().getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ═══════════════════════════════════════════════════════════════════
// INNOVAT3 — Google Apps Script (Full version with PayFast + Demo)
// ═══════════════════════════════════════════════════════════════════
// INSTRUCTIONS: Paste this ENTIRE file into your GAS editor at
// script.google.com, replacing ALL existing content.
// Then: Deploy > New Deployment > Web App > Execute as Me > Anyone
// Copy the new /exec URL and update GAS_URL everywhere.
// After deploying: Run setupDemoSheet() once, then registerWebhook().
// ═══════════════════════════════════════════════════════════════════

// ── CONFIG ──────────────────────────────────────────────────────────
var SHEET_ID        = '1_ZvLT_SnRkIgP7xiYBdDJ5DRtn9lwPnc6V3dmb-bSVI';

// ── CREDENTIALS — loaded from Script Properties (never hardcoded) ──
// Run setupSecrets() once manually after deploying to set these values.
var _props          = PropertiesService.getScriptProperties();
var BOT_TOKEN       = _props.getProperty('BOT_TOKEN')       || '';
var OWNER_CHAT_ID   = _props.getProperty('OWNER_CHAT_ID')   || '';

// ── PAYFAST CREDENTIALS ─────────────────────────────────────────────
var PF_MERCHANT_ID  = _props.getProperty('PF_MERCHANT_ID')  || '';
var PF_MERCHANT_KEY = _props.getProperty('PF_MERCHANT_KEY') || '';
var PF_PASSPHRASE   = _props.getProperty('PF_PASSPHRASE')   || '';
var PF_SANDBOX      = false;   // LIVE mode

// ── SHEET NAMES ─────────────────────────────────────────────────────
var SHEET_REGS      = 'Registrations';
var SHEET_SCANS     = 'Scan Logs';
var SHEET_TELEGRAM  = 'Telegram Chat IDs';
var SHEET_FAMILIES  = 'Family Bundles';
var SHEET_PAYMENTS  = 'Payments';
var SHEET_WAITLIST  = 'Waitlist';
var SHEET_DEMO      = 'Demo Registrations';
var SHEET_DEMO_SCANS = 'Demo Scan Logs';
var SHEET_TAG_CONTACTS = 'Tag Contacts';

// ── Shared secret — must match GAS_SECRET env var in Cloudflare Worker ─
var GAS_SECRET      = _props.getProperty('GAS_SECRET')      || '';

// ════════════════════════════════════════════════════════════════════
// doPost — handles ALL incoming POST requests
// Routes: Telegram webhook, PayFast ITN, registration form, demo
// ════════════════════════════════════════════════════════════════════
function doPost(e) {
  // ── Rate limiting handled by Cloudflare Worker (real IP) ────────
  try {
    var body = '';
    if (e.postData) {
      body = e.postData.contents || '';
    }
    var params = e.parameter || {};
    Logger.log('doPost received. body length=' + body.length + ' type=' + (e.postData ? e.postData.type : 'none'));

    // ── 1. PayFast ITN (Instant Transaction Notification) ────────────
    // PayFast sends URL-encoded form data, NOT JSON
    if (params.payment_status !== undefined || body.indexOf('payment_status') !== -1) {
      return handlePayFastITN(e);
    }

    // ── 1b. Secret key verification (non-PayFast requests) ───────────
    // All registration/scan/waitlist requests must come via Worker with secret
    var json = {};
    try { json = JSON.parse(body); } catch(ex) {}
    if (json.type === 'REGISTRATION' || json.type === 'RENEWAL' || json.type === 'WAITLIST' || json.action === 'scan') {
      if (json._secret !== GAS_SECRET) {
        Logger.log('REJECTED: invalid or missing secret key');
        return jsonResponse({ status: 'error', message: 'Unauthorized' });
      }
    }

    // ── 1c. Cash registration (admin-only, separate key) ──────────────
    if (json.type === 'CASH_REGISTRATION') {
      var adminCashKey = PropertiesService.getScriptProperties().getProperty('ADMIN_CASH_KEY') || '';
      if (!adminCashKey || json._adminKey !== adminCashKey) {
        Logger.log('REJECTED: invalid admin cash key');
        return jsonResponse({ status: 'error', message: 'Unauthorized' });
      }
      return handleCashRegistration(json);
    }

    // ── 2. Telegram webhook ──────────────────────────────────────────
    var json = {};
    try { json = JSON.parse(body); } catch(ex) {}

    if (json.message || json.callback_query) {
      return handleTelegram(json);
    }

    // ── 3. Secure profile fetch (card page) ──────────────────────────
    if (json.action === 'getProfile' && json.tagId) {
      return getSecureProfileJSONP(json.tagId, null);
    }
    if (params.action === 'getProfile' && params.tagId) {
      return getSecureProfileJSONP(params.tagId, null);
    }

    // ── 3a. Waitlist signup ──────────────────────────────────────────
    if (json.type === 'WAITLIST') {
      return handleWaitlist(json);
    }

    // ── 3b. Check email duplicate ────────────────────────────────────
    if (json.action === 'checkEmail' && json.email) {
      if (json._secret !== GAS_SECRET) {
        return jsonResponse({ status: 'error', message: 'Unauthorized' });
      }
      var ss2 = SpreadsheetApp.openById(SHEET_ID);
      var sh2 = ss2.getSheetByName(SHEET_REGS);
      if (sh2) {
        var d2 = sh2.getDataRange().getValues();
        var ec = d2[0].indexOf('Email');
        var el = json.email.toLowerCase().trim();
        for (var ri = 1; ri < d2.length; ri++) {
          if (ec !== -1 && String(d2[ri][ec]||'').toLowerCase().trim() === el) {
            return jsonResponse({ status: 'duplicate' });
          }
        }
      }
      return jsonResponse({ status: 'ok' });
    }

    // ── 3c. Demo registration ────────────────────────────────────────
    // Must be checked BEFORE the main registration block below
    if (json.action === 'demoRegister') {
      return handleDemoRegister(json);
    }

    // ── 4a. Monthly subscription renewal ────────────────────────────
    if (json.type === 'RENEWAL') {
      return handleRenewal(json);
    }

    // ── 4. Registration form submission ──────────────────────────────
    // IMPORTANT: check REGISTRATION type FIRST - register form also sends tagId
    if (json.type === 'REGISTRATION' || params.action === 'register' || json.firstName || params.firstName) {
      var regParams = (json.type === 'REGISTRATION' || json.firstName) ? json : params;
      // Map field names from form to GAS handler
      regParams.bloodType  = regParams.bloodType  || regParams.blood  || '';
      regParams.conditions = regParams.conditions || regParams.medical || '';
      regParams.medications= regParams.medications|| regParams.meds   || '';
      regParams.medAidNo   = regParams.medAidNo   || regParams.medicalAidNumber || '';
      regParams.colours    = regParams.colours    || regParams.colour || '';
      // Flatten contacts array [{name,rel,phone,wa,telegram}] → c1Name, c1Rel etc
      if (regParams.contacts && Array.isArray(regParams.contacts)) {
        regParams.contacts.forEach(function(c, i) {
          if (!c) return;
          var n = i + 1;
          regParams['c'+n+'Name']  = c.name     || '';
          regParams['c'+n+'Rel']   = c.rel      || '';
          regParams['c'+n+'Phone'] = c.phone    || '';
          regParams['c'+n+'WA']    = c.wa ? 'Yes' : 'No';
          regParams['c'+n+'TG']    = c.telegram || '';
        });
      }
      return handleRegistration(regParams);
    }

    // ── 4. Tag scan (card sends JSON body, not URL params) ──────────
    if (json.tagId || json.action === 'scan') {
      return handleScan(json);
    }
    // Fallback for URL-param style
    if (params.action === 'scan' || params.tagId) {
      return handleScan(params);
    }

    return jsonResponse({ status: 'ok', message: 'innovat3 GAS v2.1 with PayFast + Demo' });

  } catch(err) {
    Logger.log('doPost error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}


// ── Validate photo URL — must be an imgbb hosted URL ─────────────
function validatePhotoUrl(url) {
  if (!url) return '';
  var s = String(url).trim();
  if (s.startsWith('https://i.ibb.co/') || s.startsWith('https://ibb.co/')) return s;
  Logger.log('validatePhotoUrl: rejected non-imgbb URL: ' + s.substring(0, 60));
  return '';
}

// ── Format new sheet row to match existing rows ───────────────────
function formatNewRow(sheet) {
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var lastCol = sheet.getLastColumn();
    var targetRange = sheet.getRange(lastRow, 1, 1, lastCol);
    targetRange.setFontFamily('Roboto');
    targetRange.setFontSize(10);
    targetRange.setFontWeight('normal');
    targetRange.setFontColor('#ffffff');
    targetRange.setBackground('#0d1117');
    targetRange.setWrap(false);
    targetRange.setVerticalAlignment('middle');
    // Alternate row shading
    if (lastRow % 2 === 0) {
      targetRange.setBackground('#111827');
    } else {
      targetRange.setBackground('#0d1117');
    }
  } catch(e) {
    Logger.log('formatNewRow error: ' + e.toString());
  }
}


// ══════════════════════════════════════════════════════════════════
// RUN THIS ONCE MANUALLY: cleanupAndSetupSheets()
// It will fix the Scan Logs sheet and ensure correct column headers
// ══════════════════════════════════════════════════════════════════
function cleanupAndSetupSheets() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Fix Scan Logs sheet ────────────────────────────────────────
  var scanSheet = ss.getSheetByName(SHEET_SCANS);
  if (!scanSheet) {
    scanSheet = ss.insertSheet(SHEET_SCANS);
  } else {
    // Clear everything and start fresh
    scanSheet.clearContents();
    scanSheet.clearFormats();
  }

  // Set correct headers
  var scanHeaders = ['Timestamp', 'Tag ID', 'Name', 'Latitude', 'Longitude', 'Address', 'Accuracy (m)', 'Low Accuracy'];
  scanSheet.getRange(1, 1, 1, scanHeaders.length).setValues([scanHeaders]);

  // Style header row
  var hdr = scanSheet.getRange(1, 1, 1, scanHeaders.length);
  hdr.setBackground('#1a1a2e');
  hdr.setFontColor('#F97316');
  hdr.setFontWeight('bold');
  hdr.setFontSize(11);
  hdr.setFontFamily('Roboto');
  hdr.setHorizontalAlignment('center');

  // Set column widths
  scanSheet.setColumnWidth(1, 160); // Timestamp
  scanSheet.setColumnWidth(2, 140); // Tag ID
  scanSheet.setColumnWidth(3, 160); // Name
  scanSheet.setColumnWidth(4, 100); // Lat
  scanSheet.setColumnWidth(5, 100); // Lng
  scanSheet.setColumnWidth(6, 300); // Address
  scanSheet.setColumnWidth(7, 100); // Accuracy
  scanSheet.setColumnWidth(8, 100); // Low Accuracy
  scanSheet.setFrozenRows(1);

  // ── Fix Registrations sheet headers ───────────────────────────
  var regSheet = ss.getSheetByName(SHEET_REGS);
  if (regSheet) {
    // Just freeze header row and style it - don't touch data
    regSheet.setFrozenRows(1);
    var regHdr = regSheet.getRange(1, 1, 1, regSheet.getLastColumn());
    regHdr.setBackground('#1a1a2e');
    regHdr.setFontColor('#F97316');
    regHdr.setFontWeight('bold');
    regHdr.setFontSize(11);
    regHdr.setFontFamily('Roboto');
  }

  Logger.log('✅ Sheets cleaned up and formatted successfully');
  SpreadsheetApp.getUi().alert('Done! Scan Logs sheet has been reset with correct columns. Registrations header has been styled.');
}

function doGet(e) {
  var params   = e.parameter || {};
  var callback = params.callback || null;

  // ── Generate PayFast signature server-side ───────────────────
  if (params.action === 'pfSign') {
    if (params._secret !== GAS_SECRET) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, callback);
    }
    try {
      var pfParams = JSON.parse(params.pfParams || '{}');

      // PHP urlencode() in GAS — encodes same chars as PHP does
      function pfEncode(str) {
        return encodeURIComponent(String(str))
          .replace(/%20/g, '+')
          .replace(/!/g,   '%21')
          .replace(/'/g,   '%27')
          .replace(/\(/g,  '%28')
          .replace(/\)/g,  '%29')
          .replace(/\*/g,  '%2A')
          .replace(/~/g,   '%7E');
      }

      var pairs = [];
      // PayFast verifies in field order (NOT sorted) — order must match form
      var keys = Object.keys(pfParams);
      for (var ki = 0; ki < keys.length; ki++) {
        var k = keys[ki];
        var val = String(pfParams[k]).trim();
        if (val !== '') pairs.push(k + '=' + pfEncode(val));
      }
      if (PF_PASSPHRASE) pairs.push('passphrase=' + pfEncode(PF_PASSPHRASE.trim()));
      var sigStr = pairs.join('&');
      var sigBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sigStr, Utilities.Charset.UTF_8);
      var sig = sigBytes.map(function(b){ return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
      Logger.log('pfSign sigStr: ' + sigStr);
      Logger.log('pfSign sig: ' + sig);
      return jsonResponse({ status: 'ok', signature: sig }, callback);
    } catch(err) {
      return jsonResponse({ status: 'error', message: err.toString() }, callback);
    }
  }

  // ── Verify tag for reactivation — checks tag exists + email matches ─
  if (params.action === 'verifyTag' && params.tagId && params.email) {
    if (params._secret !== GAS_SECRET) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, callback);
    }
    try {
      var ss = SpreadsheetApp.openById(SHEET_ID);
      var sheet = ss.getSheetByName(SHEET_REGS);
      if (!sheet) return jsonResponse({ status: 'error', message: 'Sheet not found' }, callback);
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var tagIdCol    = headers.indexOf('Tag ID');
      var emailCol    = headers.indexOf('Email');
      var firstNameCol= headers.indexOf('First Name');
      var lastNameCol = headers.indexOf('Last Name');
      if (tagIdCol === -1 || emailCol === -1) return jsonResponse({ status: 'error', message: 'Sheet columns missing' }, callback);
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][tagIdCol]).trim().toUpperCase() === params.tagId.trim().toUpperCase()) {
          var rowEmail = String(data[i][emailCol] || '').toLowerCase().trim();
          if (rowEmail !== params.email.toLowerCase().trim()) {
            return jsonResponse({ status: 'error', message: 'Email does not match our records for this tag.' }, callback);
          }
          return jsonResponse({
            status:    'ok',
            tagId:     String(data[i][tagIdCol]),
            firstName: firstNameCol !== -1 ? String(data[i][firstNameCol] || '') : '',
            lastName:  lastNameCol  !== -1 ? String(data[i][lastNameCol]  || '') : ''
          }, callback);
        }
      }
      return jsonResponse({ status: 'error', message: 'Tag ID not found. Check your tag and try again.' }, callback);
    } catch(err) {
      return jsonResponse({ status: 'error', message: err.toString() }, callback);
    }
  }

  // ── Update photo URL after payment ───────────────────────────
  if (params.action === 'updatePhoto' && params.tagId && params.photoUrl) {
    if (params._secret !== GAS_SECRET) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, callback);
    }
    try {
      var ss = SpreadsheetApp.openById(SHEET_ID);
      var sheet = ss.getSheetByName(SHEET_REGS);
      if (!sheet) return jsonResponse({ status: 'error', message: 'Sheet not found' }, callback);
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var tagIdCol = headers.indexOf('Tag ID');
      var photoCol = headers.indexOf('Photo URL');
      if (tagIdCol === -1 || photoCol === -1) return jsonResponse({ status: 'error', message: 'Column not found' }, callback);
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][tagIdCol]) === params.tagId) {
          sheet.getRange(i + 1, photoCol + 1).setValue(validatePhotoUrl(params.photoUrl));
          return jsonResponse({ status: 'ok' }, callback);
        }
      }
      return jsonResponse({ status: 'error', message: 'Tag not found' }, callback);
    } catch(err) {
      return jsonResponse({ status: 'error', message: err.toString() }, callback);
    }
  }

  // ── Profile fetch (card page loads profile) ──────────────────
  if (params.action === 'getProfile' && params.tagId) {
    return getSecureProfileJSONP(params.tagId, callback);
  }

  // ── Alert action — card sends scan data, GAS sends Telegram ────
  if (params.action === 'alert' && params.tagId) {
    return handleAlert(params);
  }

  // ── Finder status reply — one-tap update from finder to contacts ─
  if (params.action === 'finderStatus' && params.tagId) {
    return handleFinderStatus(params);
  }

  // ── Scan log
  if (params.action === 'scan' && params.tagId) {
    return handleScan(params);
  }

  // Fallback tag scan
  if (params.tagId && !params.action) {
    return handleScan(params);
  }

  // ── Admin dashboard data fetch ──────────────────────────────────
  if (params.action === 'adminData' && params.sheet) {
    if (params.adminSecret !== GAS_SECRET) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, callback);
    }
    var ALLOWED_SHEETS = ['Registrations', 'Scan Logs', 'Payments', 'Waitlist', 'Demo Registrations', 'Demo Scan Logs', 'Telegram Chat IDs', 'Family Bundles'];
    if (ALLOWED_SHEETS.indexOf(params.sheet) === -1) {
      return jsonResponse({ status: 'error', message: 'Invalid sheet' }, callback);
    }
    try {
      var ss = SpreadsheetApp.openById(SHEET_ID);
      var sheet = ss.getSheetByName(params.sheet);
      if (!sheet) return jsonResponse({ status: 'ok', rows: [] }, callback);
      var data = sheet.getDataRange().getValues();
      if (data.length < 2) return jsonResponse({ status: 'ok', rows: [] }, callback);
      var headers = data[0].map(function(h) { return String(h).trim(); }); // trim spaces from headers
      var rows = [];
      for (var i = 1; i < data.length; i++) {
        var row = {};
        headers.forEach(function(h, idx) {
          var val = data[i][idx];
          if (val instanceof Date) {
            var dd  = ('0'+val.getDate()).slice(-2);
            var mm  = ('0'+(val.getMonth()+1)).slice(-2);
            var hh  = ('0'+val.getHours()).slice(-2);
            var min = ('0'+val.getMinutes()).slice(-2);
            // Date-only values (stored at midnight) → YYYY-MM-DD so the admin
            // dashboard regex can parse them.  Timestamps (with a real time) →
            // human-readable DD/MM/YYYY HH:MM for display in tables.
            if (val.getHours() === 0 && val.getMinutes() === 0 && val.getSeconds() === 0) {
              row[h] = val.getFullYear() + '-' + mm + '-' + dd;
            } else {
              row[h] = dd+'/'+mm+'/'+val.getFullYear()+' '+hh+':'+min;
            }
          } else {
            row[h] = (val == null ? '' : String(val));
          }
        });
        rows.push(row);
      }
      return jsonResponse({ status: 'ok', rows: rows }, callback);
    } catch(adminErr) {
      Logger.log('adminData error: ' + adminErr.toString());
      return jsonResponse({ status: 'error', message: adminErr.toString() }, callback);
    }
  }

  return jsonResponse({ status: 'ok', version: '2.1' }, callback);
}

// JSONP-aware profile fetch — checks Registrations then Demo Registrations
function getSecureProfileJSONP(tagId, callback) {
  try {
    if (!tagId) return jsonResponse({ status: 'error', message: 'No tag ID' }, callback);

    var ss = SpreadsheetApp.openById(SHEET_ID);

    // ── Check main Registrations sheet first ──────────────────────
    var result = findAndBuildProfile(ss, SHEET_REGS, tagId);
    if (result) return jsonResponse(result, callback);

    // ── Fallback: check Demo Registrations sheet ──────────────────
    result = findAndBuildProfile(ss, SHEET_DEMO, tagId);
    if (result) return jsonResponse(result, callback);

    return jsonResponse({ status: 'error', message: 'Tag not found' }, callback);

  } catch(err) {
    Logger.log('getSecureProfileJSONP error: ' + err.toString());
    return jsonResponse({ status: 'error', message: 'Server error' }, callback);
  }
}

// ── Internal helper — searches one sheet for tagId and returns safe profile ──
function findAndBuildProfile(ss, sheetName, tagId) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var tagCol  = headers.indexOf('Tag ID');
  var statusCol = headers.indexOf('Status');

  if (tagCol === -1) return null;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][tagCol]).trim() === String(tagId).trim()) {

      // Status check (main sheet has Status; demo sheet does not — that's fine)
      if (statusCol !== -1) {
        var status = String(data[i][statusCol] || '').toLowerCase();
        if (status === 'inactive' || status === 'cancelled' || status === 'suspended') {
          return { status: 'error', message: 'Tag not active' };
        }
      }

      // Expiry check — return inactive if tag has expired
      var expiryCol2 = headers.indexOf('Expiry Date');
      if (expiryCol2 !== -1) {
        var expiryVal = data[i][expiryCol2];
        var expiryDateObj = null;
        if (expiryVal instanceof Date) {
          expiryDateObj = expiryVal;
        } else if (expiryVal) {
          var expiryStr2 = String(expiryVal).trim();
          var ep2 = expiryStr2.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (ep2) expiryDateObj = new Date(+ep2[1], +ep2[2]-1, +ep2[3]);
        }
        if (expiryDateObj && !isNaN(expiryDateObj.getTime())) {
          var todayMidnight = new Date();
          todayMidnight.setHours(0, 0, 0, 0);
          if (expiryDateObj < todayMidnight) {
            var planCol2 = headers.indexOf('Plan');
            var plan2    = planCol2 !== -1 ? String(data[i][planCol2] || 'Solo').trim() : 'Solo';
            return { status: 'inactive', message: 'Tag expired', tagId: tagId, plan: plan2 };
          }
        }
      }

      var row = {};
      headers.forEach(function(h, idx) { row[h] = data[i][idx]; });

      // Strip sensitive fields before returning to card
      var SENSITIVE = [
        'Email', 'Phone', 'ID Number',
        'Delivery Address', 'Payment Status', 'Payment Amount', 'PayFast Ref',
        'Payment Date', 'Care ID Doc', 'Care Med Doc', 'Consent Date', 'Extra Notes'
      ];
      var safeProfile = {};
      var photoUrl = '';
      Object.keys(row).forEach(function(key) {
        if (key === 'Photo URL') { photoUrl = String(row[key] || ''); return; }
        if (SENSITIVE.indexOf(key) !== -1) return;
        var val = row[key];
        if (val instanceof Date) {
          var dd = ('0'+(val.getDate())).slice(-2);
          var mm = ('0'+(val.getMonth()+1)).slice(-2);
          safeProfile[key] = dd+'/'+mm+'/'+val.getFullYear();
        } else {
          safeProfile[key] = (val == null ? '' : String(val));
        }
      });

      return { status: 'ok', profile: safeProfile, photoUrl: photoUrl };
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// PAYFAST ITN HANDLER
// ════════════════════════════════════════════════════════════════════
function handlePayFastITN(e) {
  var params = e.parameter || {};

  // Parse body manually if params are empty (PayFast sends URL-encoded body)
  if (!params.payment_status && e.postData) {
    var pairs = e.postData.contents.split('&');
    pairs.forEach(function(pair) {
      var kv = pair.split('=');
      if (kv.length >= 2) {
        params[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=').replace(/\+/g, ' '));
      }
    });
  }

  Logger.log('PayFast ITN received: ' + JSON.stringify(params));

  // ── Step 1: Verify payment status ───────────────────────────────
  if (params.payment_status !== 'COMPLETE') {
    Logger.log('PayFast ITN: payment not complete, status = ' + params.payment_status);
    sendTelegramMessage(OWNER_CHAT_ID,
      '⚠️ *PayFast payment ' + params.payment_status + '*\n' +
      'Name: ' + (params.name_first || '') + ' ' + (params.name_last || '') + '\n' +
      'Amount: R' + (params.amount_gross || '?') + '\n' +
      'M Payment ID: ' + (params.m_payment_id || '?')
    );
    return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
  }

  // ── Step 2: Verify PayFast signature ────────────────────────────
  if (!verifyPayFastSignature(params)) {
    Logger.log('PayFast signature verification FAILED for tag: ' + (params.m_payment_id||'unknown'));
    return ContentService.createTextOutput('Signature verification failed').setMimeType(ContentService.MimeType.TEXT);
  }
  Logger.log('PayFast signature verified ✓');

  // ── Step 3: Extract tag ID from m_payment_id or item_description ─
  var tagId = params.m_payment_id || '';

  // Fallback: try to parse from item_description
  if (!tagId) {
    var desc = params.item_description || '';
    var match = desc.match(/IN3-\d{4}-[A-Z0-9]+/);
    if (match) tagId = match[0];
  }

  if (!tagId) {
    Logger.log('PayFast ITN: could not extract Tag ID');
    sendTelegramMessage(OWNER_CHAT_ID,
      '⚠️ *PayFast payment received but no Tag ID found*\n' +
      'Name: ' + params.name_first + ' ' + params.name_last + '\n' +
      'Amount: R' + params.amount_gross + '\n' +
      'Email: ' + (params.email_address || '?')
    );
    return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
  }

  // ── Step 4: Save registration from custom_str fields (if present) ─
  var customData = (params.custom_str1||'') + (params.custom_str2||'') +
                   (params.custom_str3||'') + (params.custom_str4||'') +
                   (params.custom_str5||'');
  if (customData && customData.length > 10) {
    try {
      var regData = JSON.parse(customData);
      regData.type   = 'REGISTRATION';
      regData.status = 'Active';
      regData.bloodType   = regData.bloodType   || regData.blood   || '';
      regData.conditions  = regData.conditions  || regData.medical || '';
      regData.medications = regData.medications || regData.meds    || '';
      regData.medAidNo    = regData.medAidNo    || regData.medicalAidNumber || '';
      handleRegistration(regData);
      Logger.log('✅ Registration saved from PayFast custom_str for tag: ' + tagId);
    } catch(parseErr) {
      Logger.log('custom_str parse error: ' + parseErr.toString());
    }
  }

  // ── Step 4b: Update Status = Active in Google Sheet ──────────────
  var result = activateSubscriber(tagId, params);

  // ── Step 5: Log payment ──────────────────────────────────────────
  logPayment(tagId, params);

  // ── Step 6: Notify owner via Telegram ────────────────────────────
  var emoji = result.success ? '✅' : '⚠️';
  sendTelegramMessage(OWNER_CHAT_ID,
    emoji + ' *Payment received!*\n' +
    '🏷️ Tag: `' + tagId + '`\n' +
    '👤 ' + params.name_first + ' ' + params.name_last + '\n' +
    '💰 R' + params.amount_gross + '\n' +
    '📧 ' + (params.email_address || '?') + '\n' +
    '🔖 ' + (params.item_name || '?') + '\n' +
    (result.success ? '✅ Status set to Active' : '⚠️ ' + result.message)
  );

  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

// ── Activate subscriber in sheet ─────────────────────────────────────
function activateSubscriber(tagId, pfParams) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_REGS);
    if (!sheet) return { success: false, message: 'Sheet not found' };

    var data = sheet.getDataRange().getValues();
    var headers   = data[0];
    var tagCol    = headers.indexOf('Tag ID');
    var statusCol = headers.indexOf('Status');
    var expiryCol = headers.indexOf('Expiry Date');
    var payCol    = headers.indexOf('Payment Status');
    var payDateCol= headers.indexOf('Payment Date');
    var payAmtCol = headers.indexOf('Payment Amount');
    var payRefCol = headers.indexOf('PayFast Ref');

    if (tagCol === -1 || statusCol === -1) {
      return { success: false, message: 'Required columns not found' };
    }

    for (var i = 1; i < data.length; i++) {
      if (data[i][tagCol] === tagId) {
        // Set expiry to 30 days from today (monthly) or 365 days (annual) based on Plan column
        var planCol = headers.indexOf('Plan');
        var planVal = planCol !== -1 ? String(data[i][planCol] || '').toLowerCase() : '';
        var expiryDays = planVal.indexOf('annual') !== -1 ? 365 : 30;
        var expiryDate = new Date(new Date().getTime() + expiryDays * 24 * 60 * 60 * 1000);
        var expiryStr  = expiryDate.toISOString().split('T')[0];

        sheet.getRange(i + 1, statusCol + 1).setValue('Active');
        if (expiryCol !== -1)  sheet.getRange(i + 1, expiryCol + 1).setValue(expiryStr);
        if (payCol !== -1)     sheet.getRange(i + 1, payCol + 1).setValue('COMPLETE');
        if (payDateCol !== -1) sheet.getRange(i + 1, payDateCol + 1).setValue(new Date());
        if (payAmtCol !== -1)  sheet.getRange(i + 1, payAmtCol + 1).setValue(pfParams.amount_gross || '');
        if (payRefCol !== -1)  sheet.getRange(i + 1, payRefCol + 1).setValue(pfParams.pf_payment_id || '');
        SpreadsheetApp.flush();
        Logger.log('Activated subscriber: ' + tagId + ' expiry=' + expiryStr);

        // ── Referral alert ─────────────────────────────────────────────
        var refCol = headers.indexOf('Referred By');
        var referredBy = refCol !== -1 ? String(data[i][refCol] || '') : '';
        if (referredBy) {
          sendTelegramMessage(OWNER_CHAT_ID,
            '🎉 *Referral Converted!*\n' +
            '🏷️ New tag: `' + tagId + '`\n' +
            '🔗 Referred by: `' + referredBy + '`\n' +
            '👉 Credit one month free to referrer.'
          );
        }

        // ── Send welcome email to subscriber ───────────────────────────
        var emailCol     = headers.indexOf('Email');
        var firstNameCol = headers.indexOf('First Name');
        var lastNameCol  = headers.indexOf('Last Name');
        var subEmail = emailCol !== -1     ? String(data[i][emailCol] || '')     : '';
        var subFirst = firstNameCol !== -1 ? String(data[i][firstNameCol] || '') : '';
        var subName  = subFirst || (lastNameCol !== -1 ? String(data[i][lastNameCol] || '') : 'there');
        var cardUrl  = 'https://innovat3.co.za/card/?tag=' + encodeURIComponent(tagId);
        var refLink  = 'https://innovat3.co.za/register/?ref=' + encodeURIComponent(tagId);

        if (subEmail) {
          try {
            GmailApp.sendEmail(
              subEmail,
              'Welcome to innovat3. — Your safety tag is active!',
              '',
              {
                name: 'innovat3.',
                htmlBody: buildWelcomeEmailHtml(subName, tagId, cardUrl, refLink)
              }
            );
            Logger.log('Welcome email sent to: ' + subEmail);
          } catch(emailErr) {
            Logger.log('Welcome email failed: ' + emailErr.toString());
          }
        }

        return { success: true };
      }
    }

    return { success: false, message: 'Tag ID not found in sheet: ' + tagId };

  } catch(err) {
    Logger.log('activateSubscriber error: ' + err.toString());
    return { success: false, message: err.toString() };
  }
}

// ── Handle monthly subscription renewal ──────────────────────────────
function handleRenewal(params) {
  try {
    var tagId = params.tagId || '';
    if (!tagId) return jsonResponse({ status: 'error', message: 'Missing tagId' });

    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_REGS);
    if (!sheet) return jsonResponse({ status: 'error', message: 'Sheet not found' });

    var data      = sheet.getDataRange().getValues();
    var headers   = data[0];
    var tagCol    = headers.indexOf('Tag ID');
    var statusCol = headers.indexOf('Status');
    var expiryCol = headers.indexOf('Expiry Date');
    var payCol    = headers.indexOf('Payment Status');
    var payDateCol= headers.indexOf('Payment Date');
    var payAmtCol = headers.indexOf('Payment Amount');
    var payRefCol = headers.indexOf('PayFast Ref');

    if (tagCol === -1) return jsonResponse({ status: 'error', message: 'Tag ID column not found' });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][tagCol] || '') === tagId) {
        // Extend expiry by 30 days from today
        var newExpiry = new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000);
        var expiryStr = newExpiry.toISOString().split('T')[0];

        if (statusCol !== -1)  sheet.getRange(i + 1, statusCol + 1).setValue('Active');
        if (expiryCol !== -1)  sheet.getRange(i + 1, expiryCol + 1).setValue(expiryStr);
        if (payCol !== -1)     sheet.getRange(i + 1, payCol + 1).setValue('COMPLETE');
        if (payDateCol !== -1) sheet.getRange(i + 1, payDateCol + 1).setValue(new Date());
        if (payAmtCol !== -1)  sheet.getRange(i + 1, payAmtCol + 1).setValue(params.paymentAmount || '');
        if (payRefCol !== -1)  sheet.getRange(i + 1, payRefCol + 1).setValue(params.payFastRef    || '');
        SpreadsheetApp.flush();

        // Fetch name from sheet for Telegram message
        var nameCol  = headers.indexOf('First Name');
        var planCol  = headers.indexOf('Plan');
        var name = nameCol  !== -1 ? String(data[i][nameCol]  || '') : tagId;
        var plan = planCol  !== -1 ? String(data[i][planCol]  || '') : '';

        sendTelegramMessage(OWNER_CHAT_ID,
          '🔄 *Monthly Renewal*\n' +
          '🏷️ Tag: `' + tagId + '`\n' +
          '👤 ' + name + '\n' +
          '📦 ' + plan + '\n' +
          '💰 R' + (params.paymentAmount || '?') + '\n' +
          '📅 Active until: ' + expiryStr
        );

        Logger.log('Renewal processed for tagId=' + tagId + ' newExpiry=' + expiryStr);
        return jsonResponse({ status: 'ok', tagId: tagId, expiryDate: expiryStr });
      }
    }

    Logger.log('Renewal: tagId not found: ' + tagId);
    return jsonResponse({ status: 'error', message: 'Tag ID not found: ' + tagId });
  } catch(err) {
    Logger.log('handleRenewal error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ── Log payment to Payments sheet ────────────────────────────────────
function logPayment(tagId, pfParams) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_PAYMENTS);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_PAYMENTS);
      sheet.appendRow(['Timestamp', 'Tag ID', 'Name', 'Email', 'Amount', 'Item', 'PF Payment ID', 'Status']);
    }

    sheet.appendRow([
      new Date(),
      tagId,
      (pfParams.name_first || '') + ' ' + (pfParams.name_last || ''),
      pfParams.email_address || '',
      pfParams.amount_gross || '',
      pfParams.item_name || '',
      pfParams.pf_payment_id || '',
      pfParams.payment_status || ''
    ]);

  } catch(err) {
    Logger.log('logPayment error: ' + err.toString());
  }
}

// ── Verify PayFast signature ──────────────────────────────────────────
function verifyPayFastSignature(params) {
  var keys = Object.keys(params).sort();
  var parts = [];

  keys.forEach(function(key) {
    if (key !== 'signature') {
      var val = (params[key] || '').toString();
      if (val !== '') {
        parts.push(key + '=' + phpUrlencode(val));
      }
    }
  });

  if (PF_PASSPHRASE) {
    parts.push('passphrase=' + phpUrlencode(PF_PASSPHRASE));
  }

  var paramString = parts.join('&');
  Logger.log('Signature string: ' + paramString);

  var expectedSig = computeMD5(paramString);
  Logger.log('Expected sig: ' + expectedSig);
  Logger.log('Received sig: ' + params.signature);

  return expectedSig === params.signature;
}

function phpUrlencode(str) {
  return encodeURIComponent(str.toString())
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, function(c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function computeMD5(input) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, input)
    .map(function(b) {
      return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
    }).join('');
}

// ════════════════════════════════════════════════════════════════════
// REGISTRATION HANDLER
// ════════════════════════════════════════════════════════════════════
function handleRegistration(params) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_REGS);
    if (!sheet) sheet = ss.insertSheet(SHEET_REGS);

    // ── ITN payment completion — update existing row, don't create a duplicate ──
    if (params.paymentStatus === 'COMPLETE' && params.tagId) {
      var activateResult = activateSubscriber(params.tagId, {
        amount_gross:  params.paymentAmount || '',
        pf_payment_id: params.payFastRef    || ''
      });
      if (activateResult.success) {
        sendTelegramMessage(OWNER_CHAT_ID,
          '💳 *Payment Confirmed*\n' +
          '🏷️ Tag: `' + params.tagId + '`\n' +
          '👤 ' + (params.firstName || '') + ' ' + (params.lastName || '') + '\n' +
          '📦 Plan: ' + (params.plan || 'Solo') + ' / ' + (params.billing || 'annual') + '\n' +
          '📧 ' + (params.email || '') + '\n' +
          '💰 Amount: R' + (params.paymentAmount || '?') + '\n' +
          '✅ Status: Active'
        );
        return jsonResponse({ status: 'ok', tagId: params.tagId });
      }
      // Tag not found in sheet (e.g. initial /register was skipped) — fall through to insert
      Logger.log('activateSubscriber could not find tagId=' + params.tagId + ' — ' + activateResult.message + '. Inserting new row.');
    }

    // ── Server-side duplicate email check ──────────────────────
    if (params.email) {
      var data    = sheet.getDataRange().getValues();
      var headers = data[0];
      var emailCol = headers.indexOf('Email');
      if (emailCol !== -1) {
        var emailLower = params.email.toLowerCase().trim();
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][emailCol] || '').toLowerCase().trim() === emailLower) {
            return jsonResponse({ status: 'duplicate', message: 'Email already registered' });
          }
        }
      }
    }

    var tagId = params.tagId || generateTagId(params.plan || 'Solo');
    var now   = new Date();

    sheet.appendRow([
      now,                                     // Timestamp
      tagId,                                   // Tag ID
      params.status || 'Pending',              // Status
      params.dob         || '',                // Date of Birth
      params.firstName   || '',                // First Name
      params.lastName    || '',                // Last Name
      params.email       || '',                // Email
      params.phone       || '',                // Phone
      params.telegram    || '',                // Telegram
      params.plan        || 'Solo',            // Plan
      params.bloodType   || '',                // Blood Type
      params.conditions  || '',                // Medical Alerts
      params.medications || '',                // Medications
      params.medicalAid  || '',                // Medical Aid
      params.medAidNo    || '',                // Medical Aid Number
      params.address     || '',                // Home Address
      params.notes       || '',                // Notes for Finder
      params.colours     || '',                // Tag Colour
      params.formFactor  || '',                // Form Factor
      params.delivery    || '',                // Delivery Address
      params.extraNotes  || '',                // Extra Notes
      params.c1Name  || '', params.c1Rel  || '', params.c1Phone || '', params.c1WA || '', params.c1TG || '',
      params.c2Name  || '', params.c2Rel  || '', params.c2Phone || '', params.c2WA || '', params.c2TG || '',
      params.c3Name  || '', params.c3Rel  || '', params.c3Phone || '', params.c3WA || '', params.c3TG || '',
      validatePhotoUrl(params.photoUrl),       // Photo URL
      'https://innovat3.co.za/card/?tag=' + tagId, // Card Link
      params.consentDate || '',                // Consent Date
      calcExpiryDate(params),                  // Expiry Date
      params.referredBy  || ''                 // Referred By
    ]);

    formatNewRow(sheet);
    SpreadsheetApp.flush();

    // Auto-link Telegram chat ID if the subscriber already messaged the bot
    if (params.telegram) {
      var existingChatId = lookupTelegramChatId(params.telegram);
      if (existingChatId) linkRegistrationTelegramId(params.telegram, existingChatId);
    }

    sendTelegramMessage(OWNER_CHAT_ID,
      '🆕 *New Registration*\n' +
      '🏷️ Tag: `' + tagId + '`\n' +
      '👤 ' + (params.firstName || '') + ' ' + (params.lastName || '') + '\n' +
      '📦 Plan: ' + (params.plan || 'Solo') + ' / ' + (params.billing || 'annual') + '\n' +
      '📧 ' + (params.email || '') + '\n' +
      '📞 ' + (params.phone || '') + '\n' +
      '⏳ Status: Pending payment'
    );

    return jsonResponse({ status: 'ok', tagId: tagId });

  } catch(err) {
    Logger.log('Registration error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════════════
// DEMO REGISTRATION HANDLER
// ════════════════════════════════════════════════════════════════════
function handleDemoRegister(data) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_DEMO);
    if (!sheet) {
      setupDemoSheet();
      sheet = ss.getSheetByName(SHEET_DEMO);
    }

    var contacts = data.contacts || [];
    var c1 = contacts[0] || {};
    var c2 = contacts[1] || {};
    var c3 = contacts[2] || {};

    sheet.appendRow([
      data.tagId            || '',
      data.timestamp        || new Date().toISOString(),
      'Demo',
      data.firstName        || '',
      data.lastName         || '',
      data.dob              || '',
      data.email            || '',
      data.phone            || '',
      data.telegram         || '',
      data.idNumber         || '',
      data.deliveryAddress  || '',
      data.bloodType        || '',
      data.conditions       || '',
      data.medications      || '',
      data.medicalAid       || '',
      data.medicalAidNumber || '',
      data.address          || '',
      data.notes            || '',
      validatePhotoUrl(data.photoUrl),
      c1.name || '', c1.rel || '', c1.phone || '', c1.wa ? 'TRUE' : 'FALSE', c1.telegram || '',
      c2.name || '', c2.rel || '', c2.phone || '', c2.wa ? 'TRUE' : 'FALSE', c2.telegram || '',
      c3.name || '', c3.rel || '', c3.phone || '', c3.wa ? 'TRUE' : 'FALSE', c3.telegram || '',
      data.consentDate      || new Date().toISOString(),
      'https://innovat3.co.za/d3m0/card/?tag=' + encodeURIComponent(data.tagId || '')
    ]);

    formatNewRow(sheet);
    SpreadsheetApp.flush();

    // Notify owner
    var fullName = ((data.firstName || '') + ' ' + (data.lastName || '')).trim();
    var contactCount = contacts.filter(function(c){ return c && c.name; }).length;
    sendTelegramMessage(OWNER_CHAT_ID,
      '🟣 *New Demo Registration*\n' +
      '👤 *' + fullName + '*\n' +
      '🏷️ Tag: `' + (data.tagId || '') + '`\n' +
      '📧 ' + (data.email || 'no email') + '\n' +
      '📞 ' + (data.phone || 'no phone') + '\n' +
      (data.telegram ? '💬 Telegram: ' + data.telegram + '\n' : '') +
      '\n🩸 Blood: ' + (data.bloodType || '?') +
      '\n🏥 Aid: ' + (data.medicalAid || 'None') +
      '\n👥 Contacts: ' + contactCount +
      '\n\n🔗 Card: https://innovat3.co.za/d3m0/card/?tag=' + encodeURIComponent(data.tagId || '')
    );

    return jsonResponse({ status: 'ok', tagId: data.tagId });

  } catch(err) {
    Logger.log('handleDemoRegister error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ── Create Demo Registrations sheet (run once manually) ──────────────
function setupDemoSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_DEMO);
  if (!sheet) sheet = ss.insertSheet(SHEET_DEMO);

  var headers = [
    'Tag ID', 'Timestamp', 'Plan',
    'First Name', 'Last Name', 'Date of Birth', 'Email', 'Phone', 'Telegram',
    'ID Number', 'Delivery Address',
    'Blood Type', 'Conditions', 'Medications',
    'Medical Aid', 'Medical Aid Number',
    'Address', 'Notes', 'Photo URL',
    'Contact 1 Name', 'Contact 1 Relation', 'Contact 1 Phone', 'Contact 1 WA', 'Contact 1 Telegram',
    'Contact 2 Name', 'Contact 2 Relation', 'Contact 2 Phone', 'Contact 2 WA', 'Contact 2 Telegram',
    'Contact 3 Name', 'Contact 3 Relation', 'Contact 3 Phone', 'Contact 3 WA', 'Contact 3 Telegram',
    'Consent Date', 'Card URL'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var hdr = sheet.getRange(1, 1, 1, headers.length);
  hdr.setBackground('#F97316');
  hdr.setFontColor('#000000');
  hdr.setFontWeight('bold');
  hdr.setFontSize(10);
  hdr.setFontFamily('Roboto');
  sheet.setFrozenRows(1);

  SpreadsheetApp.flush();
  Logger.log('✅ Demo Registrations sheet created.');
}

// ════════════════════════════════════════════════════════════════════
// SCAN / ALERT HANDLERS
// ════════════════════════════════════════════════════════════════════

// ── handleAlert — receives scan data via GET, sends Telegram alerts ──
function handleAlert(params) {
  try {
    var tagId   = params.tagId || '';
    var name    = params.name  || 'Unknown';
    var lat     = params.lat   || '';
    var lng     = params.lng   || '';
    var addr    = params.addr  || '';
    var acc     = params.acc   || '';
    var blood   = params.blood || '';
    var medAid  = params.medAid || '';
    var medical = params.medical || '';
    var isDemo  = (params.demo === '1');
    var mapsUrl = lat && lng ? 'https://www.google.com/maps?q=' + lat + ',' + lng : '';

    Logger.log('handleAlert: ' + tagId + ' name=' + name + ' demo=' + isDemo);

    var prefix = isDemo ? '🟣 [DEMO] ' : '🚨 ';
    var msg =
      prefix + '*TAG SCANNED — ' + tagId + '*\n\n' +
      '👤 *' + name + '*\n' +
      '🩸 Blood: ' + (blood || '—') + '\n' +
      '⚠️ ' + (medical || '—') + '\n' +
      '🏥 ' + (medAid || 'No medical aid') + '\n\n' +
      (mapsUrl ? '📍 ' + (addr||'') + '\n🗺️ ' + mapsUrl + '\n' : '📍 Location not available\n') +
      (acc ? '📶 Accuracy: ±' + acc + 'm\n' : '') +
      (isDemo
        ? '\n_This is a live demo of the Innovat3 Emergency Tag System._\nhttps://innovat3.co.za'
        : '\n🆘 Please respond immediately.');

    // Alert owner
    sendTelegramMessage(OWNER_CHAT_ID, msg);

    // Alert contacts by resolving Telegram usernames
    var contactTgs = [params.c1tg, params.c2tg, params.c3tg];
    var invalid = ['yes','no','true','false','1','0','','none','n/a','-'];
    contactTgs.forEach(function(uname) {
      if (!uname) return;
      var clean = uname.replace('@','').toLowerCase().trim();
      if (invalid.indexOf(clean) !== -1 || clean.length < 4) return;
      var chatId = lookupTelegramChatId(clean);
      if (chatId) sendTelegramMessage(chatId, msg);
    });

    // Log the scan (demo tags go to Demo Scan Logs)
    var scanSheetName = isDemo ? SHEET_DEMO_SCANS : SHEET_SCANS;
    var scanSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(scanSheetName);
    if (!scanSheet) {
      scanSheet = SpreadsheetApp.openById(SHEET_ID).insertSheet(scanSheetName);
      scanSheet.appendRow(['Timestamp', 'Tag ID', 'Name', 'Latitude', 'Longitude', 'Address', 'Accuracy (m)', 'Low Accuracy']);
    }
    scanSheet.appendRow([new Date(), tagId, name, lat, lng, addr, acc, false]);
    SpreadsheetApp.flush();

    return jsonResponse({ status: 'ok' });
  } catch(err) {
    Logger.log('handleAlert error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function handleFinderStatus(params) {
  try {
    var tagId       = params.tagId       || '';
    var name        = params.name        || 'Unknown';
    var statusKey   = params.status      || '';
    var statusLabel = params.statusLabel || statusKey;
    var lat         = params.lat         || '';
    var lng         = params.lng         || '';
    var mapsUrl     = lat && lng ? 'https://www.google.com/maps?q=' + lat + ',' + lng : '';

    var emojiMap = { emergency:'🔴', conscious:'🟡', found:'🟢', safe:'📍' };
    var emoji    = emojiMap[statusKey] || '📋';

    var msg =
      emoji + ' *FINDER UPDATE — ' + tagId + '*\n\n' +
      '👤 ' + name + '\n' +
      '📋 ' + statusLabel +
      (mapsUrl ? '\n\n📍 ' + mapsUrl : '') +
      '\n\n_Sent via Innovat3 Finder Status Reply._';

    Logger.log('handleFinderStatus: tagId=' + tagId + ' status=' + statusKey);

    sendTelegramMessage(OWNER_CHAT_ID, msg);

    // Look up contact TG usernames directly from the sheet — avoids URL param / column name issues
    var ss = SpreadsheetApp.openById(SHEET_ID);
    // Username-based lookup (existing contacts in Telegram Chat IDs sheet)
    var tgUsernames = getContactTelegramUsernames(ss, tagId);
    var invalid = ['yes','no','true','false','1','0','','none','n/a','-'];
    var notifiedIds = {};
    tgUsernames.forEach(function(uname) {
      if (!uname) return;
      var clean = uname.replace('@','').toLowerCase().trim();
      if (invalid.indexOf(clean) !== -1 || clean.length < 4) return;
      var cId = lookupTelegramChatId(clean);
      if (cId && !notifiedIds[cId]) { sendTelegramMessage(cId, msg); notifiedIds[cId] = true; }
    });

    // Direct-link lookup (contacts who used /link TAGID — works without a @username)
    getLinkedContactChatIds(ss, tagId).forEach(function(cId) {
      if (!notifiedIds[cId]) { sendTelegramMessage(cId, msg); notifiedIds[cId] = true; }
    });

    return jsonResponse({ status: 'ok' });
  } catch(err) {
    Logger.log('handleFinderStatus error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// Returns array of Contact N Telegram usernames for a given tagId, checked across main + demo sheets
function getContactTelegramUsernames(ss, tagId) {
  var usernames = [];
  var sheetNames = [SHEET_REGS, SHEET_DEMO];
  for (var s = 0; s < sheetNames.length; s++) {
    var sheetName = sheetNames[s];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) { Logger.log('getContactTelegramUsernames: sheet "' + sheetName + '" not found'); continue; }
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var tagCol  = headers.indexOf('Tag ID');
    if (tagCol === -1) { Logger.log('getContactTelegramUsernames: no "Tag ID" column in "' + sheetName + '"'); continue; }
    var tgCols = [1,2,3].map(function(n) {
      var i1 = headers.indexOf('Contact ' + n + ' Telegram');
      var i2 = headers.indexOf('Contact ' + n + ' TG');
      var col = i1 !== -1 ? i1 : i2;
      Logger.log('getContactTelegramUsernames: Contact ' + n + ' TG col index=' + col + ' (sheet=' + sheetName + ')');
      return col;
    });
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][tagCol]).trim() !== String(tagId).trim()) continue;
      Logger.log('getContactTelegramUsernames: found tag row ' + i + ' in "' + sheetName + '"');
      tgCols.forEach(function(col) {
        var val = col !== -1 ? String(data[i][col] || '').trim() : '';
        Logger.log('getContactTelegramUsernames: col=' + col + ' val="' + val + '"');
        if (val) usernames.push(val);
      });
      return usernames;
    }
  }
  Logger.log('getContactTelegramUsernames: tagId "' + tagId + '" not found in any sheet');
  return usernames;
}

function handleScan(params) {
  try {
    Logger.log('handleScan called. tagId=' + (params.tagId||params.tag) + ' accuracy=' + params.accuracy + ' lowAccuracy=' + params.lowAccuracy);
    var tagId = params.tagId || params.tag || '';
    var lat   = params.lat   || '';
    var lng   = params.lng   || '';
    var addr  = params.gpsAddress || params.address || params.addr || (lat && lng ? lat + ',' + lng : 'GPS not available');
    var now   = new Date();

    // Look up subscriber in both sheets
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_REGS);
    var data  = sheet ? sheet.getDataRange().getValues() : [];
    var headers = data[0] || [];

    var tagCol  = headers.indexOf('Tag ID');
    var nameCol = headers.indexOf('First Name');
    var lastCol = headers.indexOf('Last Name');
    var tgCols  = [1,2,3].map(function(n) {
      var idx1 = headers.indexOf('Contact ' + n + ' Telegram');
      var idx2 = headers.indexOf('Contact ' + n + ' TG');
      return idx1 !== -1 ? idx1 : idx2;
    });

    var found = null;
    for (var i = 1; i < data.length; i++) {
      if (data[i][tagCol] === tagId) { found = data[i]; break; }
    }

    // If not found in main sheet, check demo sheet
    if (!found) {
      var demoSheet = ss.getSheetByName(SHEET_DEMO);
      if (demoSheet) {
        var demoData    = demoSheet.getDataRange().getValues();
        var demoHeaders = demoData[0] || [];
        var demoTagCol  = demoHeaders.indexOf('Tag ID');
        headers  = demoHeaders;
        tagCol   = demoTagCol;
        nameCol  = demoHeaders.indexOf('First Name');
        lastCol  = demoHeaders.indexOf('Last Name');
        tgCols   = [1,2,3].map(function(n) { return demoHeaders.indexOf('Contact ' + n + ' Telegram'); });
        for (var j = 1; j < demoData.length; j++) {
          if (demoData[j][demoTagCol] === tagId) { found = demoData[j]; break; }
        }
      }
    }

    // ── Skip if GPS accuracy > 200m ──────────────────────────────
    var accVal = parseFloat(params.accuracy || params.gpsAccuracy || '0');
    if ((params.lowAccuracy === 'true' || params.lowAccuracy === true) && accVal > 200) {
      Logger.log('Scan skipped — weak GPS: ' + accVal + 'm for tag ' + tagId);
      return jsonResponse({ status: 'skipped', reason: 'low_accuracy', accuracy: accVal });
    }

    // Log scan (demo tags go to Demo Scan Logs)
    var isDemo = tagId.indexOf('IN3-DEMO-') === 0;
    var scanLogName = isDemo ? SHEET_DEMO_SCANS : SHEET_SCANS;
    var scanSheet = ss.getSheetByName(scanLogName);
    if (!scanSheet) {
      scanSheet = ss.insertSheet(scanLogName);
      scanSheet.appendRow(['Timestamp', 'Tag ID', 'Name', 'Latitude', 'Longitude', 'Address', 'Accuracy (m)', 'Low Accuracy']);
      var hdr = scanSheet.getRange(1, 1, 1, 8);
      hdr.setBackground('#1a1a2e').setFontColor('#F97316').setFontWeight('bold').setFontSize(10).setFontFamily('Roboto');
    }
    var scanName = found ? ((found[nameCol] || '') + ' ' + (found[lastCol] || '')).trim() : (params.name || 'Unknown');
    var accuracy  = params.accuracy || params.gpsAccuracy || '';
    var lowAcc    = params.lowAccuracy || '';
    scanSheet.appendRow([now, tagId, scanName, lat, lng, addr, accuracy, lowAcc]);
    formatNewRow(scanSheet);
    SpreadsheetApp.flush();

    // Send Telegram alerts
    if (found) {
      var fullName = (params.name || (found[nameCol] + ' ' + found[lastCol])).trim();
      var mapsUrl  = lat && lng ? 'https://www.google.com/maps?q=' + lat + ',' + lng : 'GPS not available';
      var bloodCol  = headers.indexOf('Blood Type');
      var medCol    = headers.indexOf('Medical Alerts');
      var medAidCol = headers.indexOf('Medical Aid');
      var medNoCol  = headers.indexOf('Medical Aid Number');
      var blood   = bloodCol  !== -1 ? (found[bloodCol]  || '') : (params.blood  || '');
      var medical = medCol    !== -1 ? (found[medCol]    || '') : (params.medical || '');
      var medAid  = medAidCol !== -1 ? (found[medAidCol] || '') + (medNoCol !== -1 && found[medNoCol] ? ' · ' + found[medNoCol] : '') : (params.medAid || '');
      var acc     = params.accuracy || params.gpsAccuracy || '';
      var isDemo  = tagId.indexOf('IN3-DEMO-') === 0;
      var prefix  = isDemo ? '🟣 [DEMO] ' : '';
      var msg =
        (params.lowAccuracy === 'true' || params.lowAccuracy === true ? '⚠️ *LOW GPS ACCURACY — location may be inaccurate*\n' : '') +
        prefix + '🚨 *TAG SCANNED — ' + tagId + '*\n\n' +
        '👤 *' + fullName + '*\n' +
        '📍 ' + (addr || 'Address unknown') + (params.accuracy ? ' (±' + params.accuracy + 'm)' : '') + '\n' +
        '🗺️ ' + mapsUrl + '\n' +
        '🕐 ' + now.toLocaleString('en-ZA') + '\n\n' +
        (isDemo
          ? '_This is a live demo of the Innovat3 Emergency Tag System._\nhttps://innovat3.co.za'
          : '⚕️ This person may need help. Please respond.');

      sendTelegramMessage(OWNER_CHAT_ID, msg);

      var notifiedScanIds = {};
      var invalidTg = ['yes','no','true','false','1','0','-','n/a','none',''];
      tgCols.forEach(function(col) {
        if (col === -1 || !found[col]) {
          Logger.log('handleScan: contact TG col=' + col + ' empty or not found');
          return;
        }
        var tgVal = String(found[col]).trim();
        Logger.log('handleScan: contact TG val="' + tgVal + '"');
        if (invalidTg.indexOf(tgVal.toLowerCase()) !== -1 || tgVal.length < 4) {
          Logger.log('handleScan: skipping "' + tgVal + '" (invalid/too short)');
          return;
        }
        var chatId = lookupTelegramChatId(tgVal);
        Logger.log('handleScan: lookup "' + tgVal + '" => ' + (chatId ? 'chatId=' + chatId : 'NOT FOUND in Telegram Chat IDs sheet'));
        if (chatId) { sendTelegramMessage(chatId, msg); notifiedScanIds[chatId] = true; }
      });

      // Direct-link lookup (contacts who used /link TAGID)
      getLinkedContactChatIds(ss, tagId).forEach(function(cId) {
        if (!notifiedScanIds[cId]) { sendTelegramMessage(cId, msg); notifiedScanIds[cId] = true; }
      });
    }

    return jsonResponse({ status: 'ok', tagId: tagId, found: !!found });

  } catch(err) {
    Logger.log('Scan error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════════════
// TELEGRAM HANDLER
// ════════════════════════════════════════════════════════════════════
function handleTelegram(json) {
  var msg = json.message;
  if (!msg) return jsonResponse({ status: 'ok' });

  var chatId   = msg.chat.id.toString();
  var text     = (msg.text || '').trim();
  var username = msg.from ? (msg.from.username || '') : '';
  var firstName= msg.from ? (msg.from.first_name || '') : '';

  registerTelegramChatId(chatId, username, firstName);

  if (text.toLowerCase().startsWith('/link')) {
    var linkTagId = text.slice(5).trim().toUpperCase();
    if (!linkTagId) {
      sendTelegramMessage(chatId, '❌ Please include the tag ID.\nExample: `/link IN3-2026-B073`');
    } else {
      linkContactToTag(chatId, username, firstName, linkTagId);
      sendTelegramMessage(chatId,
        '✅ *Linked to tag ' + linkTagId + '*\n\n' +
        'You will now receive emergency alerts whenever this tag is scanned.\n\n' +
        'You can link to multiple tags by sending `/link TAGID` again with a different tag ID.'
      );
    }
    return jsonResponse({ status: 'ok' });
  }

  if (text === '/start' || text === '/help') {
    sendTelegramMessage(chatId,
      '👋 *Welcome to innovat3!*\n\n' +
      'Your Telegram is now registered for emergency alerts.\n\n' +
      'To receive alerts for a specific tag, send:\n`/link TAGID`\n\nExample: `/link IN3-2026-B073`\n\n' +
      '🏷️ *innovat3.co.za* — Smart NFC Emergency Tags'
    );
  } else {
    sendTelegramMessage(chatId, '✅ Message received. Your Chat ID `' + chatId + '` is registered for innovat3 alerts.');
  }

  return jsonResponse({ status: 'ok' });
}

function linkContactToTag(chatId, username, firstName, tagId) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_TAG_CONTACTS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_TAG_CONTACTS);
      sheet.appendRow(['Tag ID', 'Chat ID', 'Username', 'First Name', 'Linked At']);
    }
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === tagId && String(data[i][1]) === String(chatId)) return;
    }
    sheet.appendRow([tagId, chatId, username || '', firstName || '', new Date()]);
    SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('linkContactToTag error: ' + err.toString());
  }
}

function getLinkedContactChatIds(ss, tagId) {
  try {
    var sheet = ss.getSheetByName(SHEET_TAG_CONTACTS);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    var ids = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(tagId).trim() && data[i][1]) {
        ids.push(String(data[i][1]));
      }
    }
    return ids;
  } catch(err) {
    Logger.log('getLinkedContactChatIds error: ' + err.toString());
    return [];
  }
}

function registerTelegramChatId(chatId, username, firstName) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_TELEGRAM);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_TELEGRAM);
      sheet.appendRow(['Chat ID', 'Username', 'First Name', 'Registered']);
    }

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString() === chatId) return;
    }

    sheet.appendRow([chatId, username, firstName, new Date()]);
    SpreadsheetApp.flush();
    // Auto-link chat ID back to any matching registration rows
    if (username) linkRegistrationTelegramId(username, chatId);
  } catch(err) {
    Logger.log('registerTelegramChatId error: ' + err.toString());
  }
}

// Writes the resolved chat ID into the 'TG Chat ID' column of every
// matching Registrations row (matched by Telegram username).
function linkRegistrationTelegramId(username, chatId) {
  try {
    var clean = username.replace('@', '').toLowerCase();
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_REGS);
    if (!sheet) return;
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var tgCol   = headers.indexOf('Telegram');
    if (tgCol === -1) return;
    var tgIdCol = headers.indexOf('TG Chat ID');
    if (tgIdCol === -1) {
      // Add the column the first time it is needed
      tgIdCol = headers.length;
      sheet.getRange(1, tgIdCol + 1).setValue('TG Chat ID');
    }
    var updated = false;
    for (var i = 1; i < data.length; i++) {
      var tgVal = String(data[i][tgCol] || '').replace('@', '').toLowerCase().trim();
      if (tgVal && tgVal === clean) {
        sheet.getRange(i + 1, tgIdCol + 1).setValue(chatId);
        updated = true;
      }
    }
    if (updated) SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('linkRegistrationTelegramId error: ' + err.toString());
  }
}

function lookupTelegramChatId(username) {
  try {
    var clean = username.replace('@','').toLowerCase();
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_TELEGRAM);
    if (!sheet) return null;

    var data    = sheet.getDataRange().getValues();
    var userCol   = 1;  // Username is col 1; Chat ID is col 0
    var chatIdCol = 0;
    for (var i = 1; i < data.length; i++) {
      if (!data[i][userCol]) continue;
      if (data[i][userCol].toString().replace('@','').toLowerCase() === clean) {
        return data[i][chatIdCol].toString();
      }
    }
    return null;
  } catch(err) {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// WAITLIST HANDLER
// ════════════════════════════════════════════════════════════════════
function handleWaitlist(params) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_WAITLIST);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_WAITLIST);
      var headers = [
        'Timestamp','First Name','Last Name','Email','Phone','Telegram',
        'Date of Birth','Blood Type','Medical Alerts','Medications',
        'Medical Aid','Medical Aid Number','Home Address','Notes for Finder',
        'Tag Colour','Form Factor','Delivery Address',
        'Contact 1 Name','Contact 1 Relation','Contact 1 Phone','Contact 1 WA','Contact 1 Telegram',
        'Contact 2 Name','Contact 2 Relation','Contact 2 Phone','Contact 2 WA','Contact 2 Telegram',
        'Contact 3 Name','Contact 3 Relation','Contact 3 Phone','Contact 3 WA','Contact 3 Telegram',
        'Photo URL','Status','Notes'
      ];
      sheet.appendRow(headers);
      var hr = sheet.getRange(1, 1, 1, headers.length);
      hr.setBackground('#0ED2C8').setFontColor('#000').setFontWeight('bold').setFontSize(9);
      sheet.setFrozenRows(1);
    }

    var data = sheet.getDataRange().getValues();
    var emailCol = data[0].indexOf('Email');
    if (emailCol !== -1) {
      var emailLower = (params.email || '').toLowerCase().trim();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][emailCol] || '').toLowerCase().trim() === emailLower) {
          return jsonResponse({ status: 'duplicate', message: 'Email already on waitlist' });
        }
      }
    }

    var c1Name='',c1Rel='',c1Phone='',c1WA='',c1TG='';
    var c2Name='',c2Rel='',c2Phone='',c2WA='',c2TG='';
    var c3Name='',c3Rel='',c3Phone='',c3WA='',c3TG='';
    if (params.contacts && Array.isArray(params.contacts)) {
      var c = params.contacts;
      if (c[0]) { c1Name=c[0].name||''; c1Rel=c[0].rel||''; c1Phone=c[0].phone||''; c1WA=c[0].wa?'Yes':'No'; c1TG=c[0].telegram||''; }
      if (c[1]) { c2Name=c[1].name||''; c2Rel=c[1].rel||''; c2Phone=c[1].phone||''; c2WA=c[1].wa?'Yes':'No'; c2TG=c[1].telegram||''; }
      if (c[2]) { c3Name=c[2].name||''; c3Rel=c[2].rel||''; c3Phone=c[2].phone||''; c3WA=c[2].wa?'Yes':'No'; c3TG=c[2].telegram||''; }
    }

    sheet.appendRow([
      new Date(),
      params.firstName   || '',
      params.lastName    || '',
      params.email       || '',
      params.phone       || '',
      params.telegram    || '',
      params.dob         || '',
      params.bloodType   || params.blood || '',
      params.conditions  || params.medical || '',
      params.medications || params.meds || '',
      params.medicalAid  || '',
      params.medAidNo    || params.medicalAidNumber || '',
      params.address     || '',
      params.notes       || '',
      params.colours     || params.colour || '',
      params.formFactor  || '',
      params.delivery    || '',
      c1Name, c1Rel, c1Phone, c1WA, c1TG,
      c2Name, c2Rel, c2Phone, c2WA, c2TG,
      c3Name, c3Rel, c3Phone, c3WA, c3TG,
      params.photoUrl    || '',
      'Waitlist',
      params.extraNotes  || ''
    ]);

    SpreadsheetApp.flush();

    sendTelegramMessage(OWNER_CHAT_ID,
      '📋 *New Waitlist Signup*\n' +
      '👤 ' + (params.firstName||'') + ' ' + (params.lastName||'') + '\n' +
      '📧 ' + (params.email||'') + '\n' +
      '📱 ' + (params.phone||'') + '\n' +
      '📅 ' + new Date().toLocaleString('en-ZA')
    );

    return jsonResponse({ status: 'ok', message: 'Added to waitlist' });

  } catch(err) {
    Logger.log('handleWaitlist error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════
function sendTelegramMessage(chatId, text) {
  try {
    var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }),
      muteHttpExceptions: true
    });
    Logger.log('TG response [' + chatId + ']: ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 200));
  } catch(err) {
    Logger.log('sendTelegramMessage error: ' + err.toString());
  }
}


function generateTagId(plan) {
  var year = new Date().getFullYear();
  var rand = Math.floor(1000 + Math.random() * 8999).toString();
  return 'IN3-' + year + '-' + rand;
}

function getSecureProfile(tagId, token) {
  return getSecureProfileJSONP(tagId, null);
}

function getProfile(tagId) {
  return getSecureProfileJSONP(tagId, null);
}

// ── Input sanitiser ───────────────────────────────────────────────
function sanitiseParams(params) {
  var clean = {};
  for (var key in params) {
    var val = String(params[key] || '');
    val = val.replace(/<[^>]*>/g, '')
             .replace(/javascript:/gi, '')
             .replace(/on\w+\s*=/gi, '')
             .substring(0, 1000);
    clean[key] = val;
  }
  return clean;
}

function jsonResponse(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════════════════════
// SETUP FUNCTIONS — Run manually from Apps Script editor
// ════════════════════════════════════════════════════════════════════

function registerWebhook() {
  // Route Telegram through the Cloudflare Worker (/telegram) instead of directly
  // to GAS — GAS redirects POST requests and the redirect drops the body (401 loop).
  // The Worker forwards correctly with redirect:follow.
  var url    = 'https://api.innovat3.co.za/telegram';
  Logger.log('Registering webhook to URL: ' + url);
  var apiUrl = 'https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(url);
  var response = UrlFetchApp.fetch(apiUrl);
  Logger.log('Webhook registered: ' + response.getContentText());
}

// Run this to see what URL Telegram's webhook is currently pointing to
function checkWebhook() {
  var apiUrl   = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo';
  var response = UrlFetchApp.fetch(apiUrl);
  Logger.log('Webhook info: ' + response.getContentText());
  var gasUrl   = ScriptApp.getService().getUrl();
  Logger.log('Current GAS URL: ' + gasUrl);
}

// Use this if registerWebhook() registers the wrong URL.
// Paste your /exec deployment URL as the argument.
function setWebhookManual(url) {
  if (!url) { Logger.log('ERROR: pass the /exec URL as argument'); return; }
  var apiUrl   = 'https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(url);
  var response = UrlFetchApp.fetch(apiUrl);
  Logger.log('setWebhookManual result: ' + response.getContentText());
}

// Test that the bot token works and sendTelegramMessage reaches OWNER
function testBot() {
  sendTelegramMessage(OWNER_CHAT_ID, '✅ GAS bot test — if you see this, the bot is working.');
  Logger.log('Test message sent to OWNER_CHAT_ID=' + OWNER_CHAT_ID);
}

// ── MANUAL CONTACT REGISTRATION ─────────────────────────────────────
// Use this when a contact cannot message the bot themselves.
// Step 1: Ask the contact to message @userinfobot on Telegram — it replies with their Chat ID number.
// Step 2: Call this function with their chatId and the tagId they should receive alerts for.
// Example: manuallyLinkContact('123456789', 'IN3-2026-B073', 'Lietertiet')
function manuallyLinkContact(chatId, tagId, firstName) {
  if (!chatId || !tagId) { Logger.log('ERROR: chatId and tagId are required'); return; }
  chatId    = String(chatId).trim();
  tagId     = tagId.trim().toUpperCase();
  firstName = (firstName || '').trim();

  var ss = SpreadsheetApp.openById(SHEET_ID);

  // Register in Telegram Chat IDs sheet
  var tgSheet = ss.getSheetByName(SHEET_TELEGRAM);
  if (!tgSheet) {
    tgSheet = ss.insertSheet(SHEET_TELEGRAM);
    tgSheet.appendRow(['Chat ID', 'Username', 'First Name', 'Registered']);
  }
  var tgData = tgSheet.getDataRange().getValues();
  var alreadyInTg = false;
  for (var i = 1; i < tgData.length; i++) {
    if (String(tgData[i][0]) === chatId) { alreadyInTg = true; break; }
  }
  if (!alreadyInTg) {
    tgSheet.appendRow([chatId, '', firstName, new Date()]);
    Logger.log('Added ' + firstName + ' (chatId=' + chatId + ') to Telegram Chat IDs sheet');
  } else {
    Logger.log(firstName + ' (chatId=' + chatId + ') already in Telegram Chat IDs sheet');
  }

  // Register in Tag Contacts sheet (direct link)
  linkContactToTag(chatId, '', firstName, tagId);
  Logger.log('Linked chatId=' + chatId + ' to tag ' + tagId);

  // Send confirmation message to the contact
  sendTelegramMessage(chatId,
    '✅ *You are now registered for innovat3 alerts!*\n\n' +
    '👋 Hi ' + (firstName || 'there') + '! You have been linked to tag *' + tagId + '*.\n\n' +
    'You will receive an emergency alert whenever this tag is scanned.\n\n' +
    '🏷️ *innovat3.co.za* — Smart NFC Emergency Tags'
  );
  Logger.log('Sent confirmation message to ' + firstName + ' (chatId=' + chatId + ')');
  sendTelegramMessage(OWNER_CHAT_ID, '✅ Manual link complete: ' + firstName + ' (chatId=' + chatId + ') linked to ' + tagId);
}

// ── TEST SCAN ALERT ──────────────────────────────────────────────────
// Simulates a real scan alert and sends it to all registered contacts for a tag.
// Use this to verify contacts receive alerts before a real scan.
function testScanAlert(tagId) {
  if (!tagId) { Logger.log('ERROR: pass a tagId'); return; }
  tagId = tagId.trim().toUpperCase();
  var fakeParams = {
    tagId: tagId, lat: '', lng: '', gpsAddress: 'Test scan — not a real emergency',
    accuracy: '', lowAccuracy: 'false', name: ''
  };
  Logger.log('Running test scan for tag: ' + tagId);
  handleScan(fakeParams);
  Logger.log('Test scan complete — check Telegram messages');
}

function fixLietertiet() {
  manuallyLinkContact('8712446307', 'IN3-2026-B073', 'Jeanine');
}

function runTestScan() {
  testScanAlert('IN3-2026-B073');
}

// ── BULK LINK ALL EXISTING CONTACTS ─────────────────────────────────
// For every registration row that has a contact Telegram username,
// looks up their chatId in the Telegram Chat IDs sheet and links them
// directly to their tag. Run once after registerWebhook() is fixed.
// Reports a summary to owner via Telegram.
function bulkLinkAllContacts() {
  var ss      = SpreadsheetApp.openById(SHEET_ID);
  var regsSheet = ss.getSheetByName(SHEET_REGS);
  if (!regsSheet) { Logger.log('No Registrations sheet'); return; }
  var data    = regsSheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var tagCol  = headers.indexOf('Tag ID');
  var invalid = ['yes','no','true','false','1','0','','none','n/a','-'];
  var linked = [], missing = [];

  for (var i = 1; i < data.length; i++) {
    var tagId = String(data[i][tagCol] || '').trim();
    if (!tagId) continue;
    for (var n = 1; n <= 3; n++) {
      var nameCol = headers.indexOf('Contact ' + n + ' Name');
      var tgCol1  = headers.indexOf('Contact ' + n + ' Telegram');
      var tgCol2  = headers.indexOf('Contact ' + n + ' TG');
      var tgCol   = tgCol1 !== -1 ? tgCol1 : tgCol2;
      if (tgCol === -1) continue;
      var tgVal   = String(data[i][tgCol] || '').trim();
      var cName   = nameCol !== -1 ? String(data[i][nameCol] || '').trim() : ('Contact ' + n);
      if (!tgVal || invalid.indexOf(tgVal.toLowerCase()) !== -1 || tgVal.length < 4) continue;
      var clean   = tgVal.replace('@', '').toLowerCase();
      var chatId  = lookupTelegramChatId(clean);
      if (chatId) {
        linkContactToTag(chatId, clean, cName, tagId);
        linked.push(cName + ' (' + tgVal + ') → ' + tagId);
        Logger.log('Linked: ' + cName + ' chatId=' + chatId + ' → ' + tagId);
      } else {
        missing.push(cName + ' (' + tgVal + ') for ' + tagId);
        Logger.log('Missing chatId: ' + cName + ' (' + tgVal + ') for ' + tagId);
      }
    }
  }

  var msg = '📋 *Bulk Link Report*\n\n';
  if (linked.length) {
    msg += '✅ *Linked (' + linked.length + '):*\n' + linked.map(function(x){ return '• ' + x; }).join('\n') + '\n\n';
  }
  if (missing.length) {
    msg += '⚠️ *Need to message bot first (' + missing.length + '):*\n' + missing.map(function(x){ return '• ' + x; }).join('\n') + '\n\n';
    msg += '_Ask them to message @innovat3bot with /start, then run bulkLinkAllContacts again._';
  }
  if (!linked.length && !missing.length) msg += 'No contacts with Telegram usernames found.';
  sendTelegramMessage(OWNER_CHAT_ID, msg);
  Logger.log('bulkLinkAllContacts done. Linked: ' + linked.length + ', Missing: ' + missing.length);
}

function formatAllSheets() {
  var ss     = SpreadsheetApp.openById(SHEET_ID);
  var orange = '#F97316';
  var white  = '#FFFFFF';

  [SHEET_REGS, SHEET_SCANS, SHEET_TELEGRAM, SHEET_FAMILIES, SHEET_PAYMENTS, SHEET_DEMO, SHEET_DEMO_SCANS].forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn());
    header.setBackground(orange).setFontColor(white).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).setFontFamily('Roboto Mono');
  });

  Logger.log('All sheets formatted.');
}

// ── setupSecrets() — already run, values stored in Script Properties ─
// To update a secret: add it back here, run once, then clear again.
function setupSecrets() {
  PropertiesService.getScriptProperties().setProperties({
    'BOT_TOKEN':       '', // fill in and run once to update
    'OWNER_CHAT_ID':   '', // fill in and run once to update
    'PF_MERCHANT_ID':  '', // fill in and run once to update
    'PF_MERCHANT_KEY': '', // fill in and run once to update
    'PF_PASSPHRASE':   '', // fill in and run once to update
    'GAS_SECRET':      ''  // fill in and run once to update
  });
  Logger.log('Values cleared. Secrets remain in Script Properties until overwritten.');
}


// ════════════════════════════════════════════════════════════════════
// RENEWAL REMINDER — runs daily via time-based trigger
// Finds monthly subscribers expiring in 7 days and sends payment link
// Setup: GAS Editor → Triggers → Add Trigger → sendRenewalReminders
//        → Time-driven → Day timer → 8am–9am
// ════════════════════════════════════════════════════════════════════
function sendRenewalReminders() {
  try {
    var ss      = SpreadsheetApp.openById(SHEET_ID);
    var sheet   = ss.getSheetByName(SHEET_REGS);
    if (!sheet) return;

    var data    = sheet.getDataRange().getValues();
    var headers = data[0];

    var tagCol    = headers.indexOf('Tag ID');
    var nameCol   = headers.indexOf('First Name');
    var emailCol  = headers.indexOf('Email');
    var planCol   = headers.indexOf('Plan');
    var statusCol = headers.indexOf('Status');
    var expiryCol = headers.indexOf('Expiry Date');
    var tgCol     = headers.indexOf('Telegram');

    if (tagCol === -1 || expiryCol === -1) return;

    var now     = new Date();
    var in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    for (var i = 1; i < data.length; i++) {
      var row     = data[i];
      var status  = String(row[statusCol] || '').toLowerCase();
      var plan    = String(row[planCol]   || '').toLowerCase();
      var expiry  = String(row[expiryCol] || '').trim();

      // Only active monthly subscribers
      if (status !== 'active') continue;
      if (plan.indexOf('annual') !== -1 || plan.indexOf('care') !== -1) continue;

      var ep = expiry.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!ep) continue;
      var expiryDate = new Date(+ep[1], +ep[2]-1, +ep[3]);
      var daysLeft   = Math.ceil((expiryDate - now) / (1000*60*60*24));

      if (daysLeft !== 7) continue; // only fire exactly 7 days before

      var tagId    = String(row[tagCol]  || '');
      var name     = String(row[nameCol] || '');
      var email    = String(row[emailCol]|| '');
      var tg       = String(row[tgCol]   || '');

      // Determine renewal amount from plan
      var renewalAmount = plan.indexOf('family') !== -1 ? '149.00' : '49.00';
      var planLabel     = plan.indexOf('family') !== -1 ? 'Family'  : 'Solo';

      // Build PayFast payment link (no passphrase — proven working)
      var pfParams = {
        merchant_id:   PF_MERCHANT_ID,
        merchant_key:  PF_MERCHANT_KEY,
        return_url:    'https://innovat3.co.za/success.html',
        cancel_url:    'https://innovat3.co.za/',
        notify_url:    'https://api.innovat3.co.za/itn',
        m_payment_id:  tagId,
        amount:        renewalAmount,
        item_name:     'Innovat3 ' + planLabel + ' Monthly Renewal',
        name_first:    name,
        email_address: email
      };

      // Build signature string (ksort, no passphrase)
      var keys = Object.keys(pfParams).sort();
      var parts = [];
      keys.forEach(function(k) {
        var v = String(pfParams[k]).trim();
        if (v !== '') parts.push(k + '=' + encodeURIComponent(v).replace(/%20/g,'+'));
      });
      var sigBytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5,
        parts.join('&'),
        Utilities.Charset.UTF_8
      );
      var sig = sigBytes.map(function(b){ return ('0'+(b&0xFF).toString(16)).slice(-2); }).join('');
      pfParams['signature'] = sig;

      // Build PayFast URL
      var pfUrl = 'https://www.payfast.co.za/eng/process?';
      Object.keys(pfParams).forEach(function(k) {
        pfUrl += k + '=' + encodeURIComponent(pfParams[k]) + '&';
      });
      pfUrl = pfUrl.slice(0, -1);

      sendTelegramMessage(OWNER_CHAT_ID,
        '⏰ *Renewal Reminder Sent*\n' +
        '🏷️ Tag: `' + tagId + '`\n' +
        '👤 ' + name + '\n' +
        '📧 ' + email + '\n' +
        '💰 R' + renewalAmount + '\n' +
        '📅 Expires: ' + expiry
      );

      // Send email to subscriber
      if (email) {
        GmailApp.sendEmail(email,
          'Renew your Innovat3 tag — expires in 7 days',
          '',
          {
            htmlBody:
              '<p>Hi ' + name + ',</p>' +
              '<p>Your Innovat3 ' + planLabel + ' tag (<strong>' + tagId + '</strong>) expires on <strong>' + expiry + '</strong>.</p>' +
              '<p>Click below to renew for another month:</p>' +
              '<p><a href="' + pfUrl + '" style="background:#F97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Renew Now — R' + renewalAmount + '</a></p>' +
              '<p>If you have any questions, reply to this email.</p>' +
              '<p>The Innovat3 Team</p>',
            name: 'Innovat3'
          }
        );
      }

      // Send Telegram to subscriber if they have a chat ID
      if (tg) {
        sendTelegramMessage(tg,
          '⏰ *Your Innovat3 tag expires in 7 days!*\n' +
          '🏷️ Tag: `' + tagId + '`\n' +
          '💰 Renew for R' + renewalAmount + ':\n' + pfUrl
        );
      }

      Logger.log('Renewal reminder sent for: ' + tagId);
    }
  } catch(err) {
    Logger.log('sendRenewalReminders error: ' + err.toString());
  }
}


// ════════════════════════════════════════════════════════════════════
// CASH REGISTRATION HANDLER (admin-only, bypasses PayFast)
// ════════════════════════════════════════════════════════════════════
function handleCashRegistration(params) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_REGS);
    if (!sheet) sheet = ss.insertSheet(SHEET_REGS);

    var tagId = params.tagId || generateTagId(params.plan || 'Solo');
    var now   = new Date();

    // Calculate expiry based on plan/billing
    var expiryDate = calcExpiryDate(params);

    sheet.appendRow([
      now,                                           // Timestamp
      tagId,                                         // Tag ID
      'Active',                                      // Status — cash = immediately active
      params.dob         || '',                      // Date of Birth
      params.firstName   || '',                      // First Name
      params.lastName    || '',                      // Last Name
      params.email       || '',                      // Email
      params.phone       || '',                      // Phone
      params.telegram    || '',                      // Telegram
      params.plan        || 'Solo',                  // Plan
      params.bloodType   || '',                      // Blood Type
      params.conditions  || '',                      // Medical Alerts
      params.medications || '',                      // Medications
      params.medicalAid  || '',                      // Medical Aid
      params.medAidNo    || '',                      // Medical Aid Number
      params.address     || '',                      // Home Address
      params.notes       || '',                      // Notes for Finder
      params.colours     || '',                      // Tag Colour
      params.formFactor  || '',                      // Form Factor
      params.delivery    || '',                      // Delivery Address
      params.extraNotes  || '',                      // Extra Notes
      params.c1Name  || '', params.c1Rel  || '', params.c1Phone || '', params.c1WA || '', params.c1TG || '',
      params.c2Name  || '', params.c2Rel  || '', params.c2Phone || '', params.c2WA || '', params.c2TG || '',
      params.c3Name  || '', params.c3Rel  || '', params.c3Phone || '', params.c3WA || '', params.c3TG || '',
      validatePhotoUrl(params.photoUrl || ''),       // Photo URL
      'https://innovat3.co.za/card/?tag=' + tagId,  // Card Link
      now,                                           // Consent Date (admin registering = consented)
      expiryDate                                     // Expiry Date
    ]);

    // Set payment columns explicitly
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var lastRow = sheet.getLastRow();

    var payStatusCol  = headers.indexOf('Payment Status');
    var payAmountCol  = headers.indexOf('Payment Amount');
    var payDateCol    = headers.indexOf('Payment Date');
    var payRefCol     = headers.indexOf('PayFast Ref');

    if (payStatusCol  !== -1) sheet.getRange(lastRow, payStatusCol  + 1).setValue('CASH');
    if (payAmountCol  !== -1) sheet.getRange(lastRow, payAmountCol  + 1).setValue(params.cashAmount || '');
    if (payDateCol    !== -1) sheet.getRange(lastRow, payDateCol    + 1).setValue(now);
    if (payRefCol     !== -1) sheet.getRange(lastRow, payRefCol     + 1).setValue('CASH-' + tagId);

    formatNewRow(sheet);
    SpreadsheetApp.flush();

    sendTelegramMessage(OWNER_CHAT_ID,
      '💵 *Cash Registration*\n' +
      '🏷️ Tag: `' + tagId + '`\n' +
      '👤 ' + (params.firstName || '') + ' ' + (params.lastName || '') + '\n' +
      '📦 Plan: ' + (params.plan || 'Solo') + ' / ' + (params.billing || 'once-off') + '\n' +
      '📧 ' + (params.email || '') + '\n' +
      '📞 ' + (params.phone || '') + '\n' +
      '💵 Cash: R' + (params.cashAmount || '?') + '\n' +
      '✅ Status: Active'
    );

    return jsonResponse({ status: 'ok', tagId: tagId });

  } catch(err) {
    Logger.log('Cash registration error: ' + err.toString());
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ── Builds the HTML body for the welcome email ───────────────────────
function buildWelcomeEmailHtml(name, tagId, cardUrl, refLink) {
  var logoUrl = 'https://innovat3.co.za/logo.png';
  return (
    '<table width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#0d0d0d" style="font-family:Arial,Helvetica,sans-serif;background:#0d0d0d;">' +

      // ── Banner ────────────────────────────────────────────────
      '<tr><td bgcolor="#0d0d0d" style="background:linear-gradient(135deg,#0d0d0d 0%,#1a0a00 100%);border-bottom:3px solid #F97316;padding:13px 18px;">' +
        '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
          '<td width="54" style="vertical-align:middle;padding-right:14px;">' +
            '<img src="' + logoUrl + '" width="46" height="46" alt="innovat3." style="display:block;border:2px solid #F97316;border-radius:11px;">' +
          '</td>' +
          '<td style="vertical-align:middle;">' +
            '<div style="font-size:20px;font-weight:900;color:#F97316;line-height:1;letter-spacing:-0.5px;">innovat3<span style="color:#ffffff;">.</span></div>' +
            '<div style="font-size:9px;color:#555555;letter-spacing:3px;text-transform:uppercase;margin-top:3px;">Smart NFC Emergency Tag</div>' +
          '</td>' +
          '<td style="vertical-align:middle;text-align:right;">' +
            '<span style="background:#130000;border:2px solid #EF4444;color:#EF4444;font-size:8px;font-weight:900;letter-spacing:1px;padding:6px 10px;border-radius:8px;text-transform:uppercase;">&#128680; Active</span>' +
          '</td>' +
        '</tr></table>' +
      '</td></tr>' +

      // ── Hero ──────────────────────────────────────────────────
      '<tr><td bgcolor="#141414" style="background:#141414;border-bottom:1px solid #222;padding:22px 24px;">' +
        '<p style="font-size:22px;font-weight:900;color:#F97316;margin:0 0 8px;line-height:1.2;">Your tag is live, ' + name + '! &#127881;</p>' +
        '<p style="font-size:13px;color:#777;margin:0 0 12px;letter-spacing:2px;text-transform:uppercase;">Tag ID</p>' +
        '<p style="font-family:monospace;font-size:16px;font-weight:700;color:#fff;background:#0a0a0a;border:1px solid #333;border-left:3px solid #F97316;padding:10px 14px;margin:0;letter-spacing:1px;">' + tagId + '</p>' +
      '</td></tr>' +

      // ── Steps ─────────────────────────────────────────────────
      '<tr><td bgcolor="#0e0e0e" style="background:#0e0e0e;padding:22px 24px;">' +
        '<p style="font-size:11px;color:#555;letter-spacing:3px;text-transform:uppercase;margin:0 0 16px;">Getting Started</p>' +

        // Step 1
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;"><tr>' +
          '<td width="36" style="vertical-align:top;padding-right:14px;">' +
            '<div style="width:28px;height:28px;background:#F97316;border-radius:50%;text-align:center;line-height:28px;font-weight:900;font-size:13px;color:#000;">1</div>' +
          '</td>' +
          '<td style="vertical-align:top;padding:4px 0;">' +
            '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Attach your tag</div>' +
            '<div style="font-size:13px;color:#888;line-height:1.6;">Attach the tag to wherever the person you registered spends most of their time:<br>' +
            '<span style="color:#ccc;">&#8226; Key ring or bag strap</span><br>' +
            '<span style="color:#ccc;">&#8226; Pet collar or harness</span><br>' +
            '<span style="color:#ccc;">&#8226; Vehicle key chain</span><br>' +
            '<span style="color:#ccc;">&#8226; Child\'s school bag or lunchbox</span></div>' +
          '</td>' +
        '</tr></table>' +

        // Step 2
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;"><tr>' +
          '<td width="36" style="vertical-align:top;padding-right:14px;">' +
            '<div style="width:28px;height:28px;background:#F97316;border-radius:50%;text-align:center;line-height:28px;font-weight:900;font-size:13px;color:#000;">2</div>' +
          '</td>' +
          '<td style="vertical-align:top;padding:4px 0;">' +
            '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Test your emergency card</div>' +
            '<div style="font-size:13px;color:#888;line-height:1.6;">Tap your NFC tag with any smartphone, or click the button below to open your card. Confirm your name, photo, blood type and emergency contacts all appear correctly. If anything needs updating, contact us.</div>' +
          '</td>' +
        '</tr></table>' +

        // Step 3
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;"><tr>' +
          '<td width="36" style="vertical-align:top;padding-right:14px;">' +
            '<div style="width:28px;height:28px;background:#F97316;border-radius:50%;text-align:center;line-height:28px;font-weight:900;font-size:13px;color:#000;">3</div>' +
          '</td>' +
          '<td style="vertical-align:top;padding:4px 0;">' +
            '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Set up GPS alerts on Telegram</div>' +
            '<div style="font-size:13px;color:#888;line-height:1.6;">To receive instant GPS alerts when your tag is scanned:<br>' +
            '<span style="color:#ccc;">1. Download the <strong style="color:#fff;">Telegram</strong> app on your phone</span><br>' +
            '<span style="color:#ccc;">2. Search for <a href="https://t.me/innovat3bot" style="color:#0ED2C8;font-weight:700;text-decoration:none;">@innovat3bot</a> in Telegram</span><br>' +
            '<span style="color:#ccc;">3. Tap <strong style="color:#fff;">Start</strong> and follow the instructions</span><br>' +
            '<span style="color:#ccc;">4. The bot will confirm your tag is linked to your account</span></div>' +
          '</td>' +
        '</tr></table>' +

        // Step 4
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;"><tr>' +
          '<td width="36" style="vertical-align:top;padding-right:14px;">' +
            '<div style="width:28px;height:28px;background:#F97316;border-radius:50%;text-align:center;line-height:28px;font-weight:900;font-size:13px;color:#000;">4</div>' +
          '</td>' +
          '<td style="vertical-align:top;padding:4px 0;">' +
            '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Activate your emergency contacts</div>' +
            '<div style="font-size:13px;color:#888;line-height:1.6;">For each person listed as your emergency contact:<br>' +
            '<span style="color:#ccc;">1. Ask them to download <strong style="color:#fff;">Telegram</strong></span><br>' +
            '<span style="color:#ccc;">2. Have them message <a href="https://t.me/innovat3bot" style="color:#0ED2C8;font-weight:700;text-decoration:none;">@innovat3bot</a> and tap <strong style="color:#fff;">Start</strong></span><br>' +
            '<span style="color:#ccc;">3. They will automatically receive GPS alerts whenever your tag is tapped</span></div>' +
          '</td>' +
        '</tr></table>' +

        // Step 5
        '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
          '<td width="36" style="vertical-align:top;padding-right:14px;">' +
            '<div style="width:28px;height:28px;background:#F97316;border-radius:50%;text-align:center;line-height:28px;font-weight:900;font-size:13px;color:#000;">5</div>' +
          '</td>' +
          '<td style="vertical-align:top;padding:4px 0;">' +
            '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Keep your profile up to date</div>' +
            '<div style="font-size:13px;color:#888;line-height:1.6;">If your medical info, contacts, or photo ever change, contact us at <a href="mailto:info@innovat3.co.za" style="color:#0ED2C8;font-weight:700;text-decoration:none;">info@innovat3.co.za</a> or WhatsApp <a href="https://wa.me/27725883875" style="color:#0ED2C8;font-weight:700;text-decoration:none;">+27 72 588 3875</a> and we\'ll update your card. Your tag ID stays the same forever.</div>' +
          '</td>' +
        '</tr></table>' +

      '</td></tr>' +

      // ── CTA ───────────────────────────────────────────────────
      '<tr><td bgcolor="#141414" style="background:#141414;border-top:1px solid #222;padding:24px;text-align:center;">' +
        '<a href="' + cardUrl + '" style="background:#F97316;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:900;font-size:15px;display:inline-block;letter-spacing:0.5px;">View My Tag Card &#8594;</a>' +
      '</td></tr>' +

      // ── Referral ──────────────────────────────────────────────
      (refLink ?
      '<tr><td bgcolor="#0d0d0d" style="background:#0d0d0d;border-top:1px solid #222;padding:20px 24px;text-align:center;">' +
        '<p style="font-size:12px;color:#555;margin:0 0 8px;letter-spacing:2px;text-transform:uppercase;">Refer a Friend — Get 1 Month Free</p>' +
        '<p style="font-size:12px;color:#888;margin:0 0 12px;line-height:1.6;">Share your unique link. When a friend subscribes, you both win — they get protected and you get a free month.</p>' +
        '<a href="' + refLink + '" style="background:#1a1a1a;border:1px solid #F97316;color:#F97316;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:12px;display:inline-block;letter-spacing:1px;word-break:break-all;">' + refLink + '</a>' +
      '</td></tr>'
      : '') +

      // ── Support ───────────────────────────────────────────────
      '<tr><td bgcolor="#0a0a0a" style="background:#0a0a0a;border-top:1px solid #1a1a1a;padding:16px 24px;text-align:center;">' +
        '<p style="font-size:12px;color:#555;margin:0 0 6px;">Need help? Contact us:</p>' +
        '<p style="font-size:13px;margin:0;">' +
          '<a href="https://wa.me/27725883875" style="color:#0ED2C8;font-weight:700;text-decoration:none;">WhatsApp: +27 72 588 3875</a>' +
          ' &nbsp;|&nbsp; ' +
          '<a href="mailto:info@innovat3.co.za" style="color:#0ED2C8;font-weight:700;text-decoration:none;">info@innovat3.co.za</a>' +
        '</p>' +
      '</td></tr>' +

      // ── Footer bar ────────────────────────────────────────────
      '<tr><td bgcolor="#F97316" height="4" style="font-size:0;line-height:0;">&nbsp;</td></tr>' +

    '</table>'
  );
}


