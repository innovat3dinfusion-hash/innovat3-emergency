// ═══════════════════════════════════════════════════════════════════
// INNOVAT3 — Cloudflare Worker v3.2
// Added: MD5 in-worker PayFast signature, /itn PayFast webhook route
// ═══════════════════════════════════════════════════════════════════

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyLJPu_nGH3AdZ8WSULCUpOrnAYOkGVcSGnb2LI5eJDt2Vpm-D45s_KGh3Uj1Q9y3ah/exec';

// ── MD5 (pure JS) — for PayFast signature generation ─────────────
function md5hex(str) {
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function rol(n, s) { return (n << s) | (n >>> (32 - s)); }
  function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function ff(a,b,c,d,x,s,t) { return cmn((b&c)|((~b)&d),a,b,x,s,t); }
  function gg(a,b,c,d,x,s,t) { return cmn((b&d)|(c&(~d)),a,b,x,s,t); }
  function hh(a,b,c,d,x,s,t) { return cmn(b^c^d,a,b,x,s,t); }
  function ii(a,b,c,d,x,s,t) { return cmn(c^(b|(~d)),a,b,x,s,t); }
  // UTF-8 encode
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) { bytes.push((c >> 6) | 0xC0); bytes.push((c & 0x3F) | 0x80); }
    else { bytes.push((c >> 12) | 0xE0); bytes.push(((c >> 6) & 0x3F) | 0x80); bytes.push((c & 0x3F) | 0x80); }
  }
  const len8 = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  let bl = len8 * 8;
  for (let i = 0; i < 8; i++) { bytes.push(bl & 0xff); bl >>>= 8; }
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let i = 0; i < bytes.length; i += 64) {
    const m = [];
    for (let j = 0; j < 16; j++) {
      const o = i + j*4;
      m[j] = bytes[o] | (bytes[o+1]<<8) | (bytes[o+2]<<16) | (bytes[o+3]<<24);
    }
    const [aa, bb, cc, dd] = [a, b, c, d];
    a=ff(a,b,c,d,m[0],7,-680876936);    d=ff(d,a,b,c,m[1],12,-389564586);
    c=ff(c,d,a,b,m[2],17,606105819);    b=ff(b,c,d,a,m[3],22,-1044525330);
    a=ff(a,b,c,d,m[4],7,-176418897);    d=ff(d,a,b,c,m[5],12,1200080426);
    c=ff(c,d,a,b,m[6],17,-1473231341);  b=ff(b,c,d,a,m[7],22,-45705983);
    a=ff(a,b,c,d,m[8],7,1770035416);    d=ff(d,a,b,c,m[9],12,-1958414417);
    c=ff(c,d,a,b,m[10],17,-42063);      b=ff(b,c,d,a,m[11],22,-1990404162);
    a=ff(a,b,c,d,m[12],7,1804603682);   d=ff(d,a,b,c,m[13],12,-40341101);
    c=ff(c,d,a,b,m[14],17,-1502002290); b=ff(b,c,d,a,m[15],22,1236535329);
    a=gg(a,b,c,d,m[1],5,-165796510);    d=gg(d,a,b,c,m[6],9,-1069501632);
    c=gg(c,d,a,b,m[11],14,643717713);   b=gg(b,c,d,a,m[0],20,-373897302);
    a=gg(a,b,c,d,m[5],5,-701558691);    d=gg(d,a,b,c,m[10],9,38016083);
    c=gg(c,d,a,b,m[15],14,-660478335);  b=gg(b,c,d,a,m[4],20,-405537848);
    a=gg(a,b,c,d,m[9],5,568446438);     d=gg(d,a,b,c,m[14],9,-1019803690);
    c=gg(c,d,a,b,m[3],14,-187363961);   b=gg(b,c,d,a,m[8],20,1163531501);
    a=gg(a,b,c,d,m[13],5,-1444681467);  d=gg(d,a,b,c,m[2],9,-51403784);
    c=gg(c,d,a,b,m[7],14,1735328473);   b=gg(b,c,d,a,m[12],20,-1926607734);
    a=hh(a,b,c,d,m[5],4,-378558);       d=hh(d,a,b,c,m[8],11,-2022574463);
    c=hh(c,d,a,b,m[11],16,1839030562);  b=hh(b,c,d,a,m[14],23,-35309556);
    a=hh(a,b,c,d,m[1],4,-1530992060);   d=hh(d,a,b,c,m[4],11,1272893353);
    c=hh(c,d,a,b,m[7],16,-155497632);   b=hh(b,c,d,a,m[10],23,-1094730640);
    a=hh(a,b,c,d,m[13],4,681279174);    d=hh(d,a,b,c,m[0],11,-358537222);
    c=hh(c,d,a,b,m[3],16,-722521979);   b=hh(b,c,d,a,m[6],23,76029189);
    a=hh(a,b,c,d,m[9],4,-640364487);    d=hh(d,a,b,c,m[12],11,-421815835);
    c=hh(c,d,a,b,m[15],16,530742520);   b=hh(b,c,d,a,m[2],23,-995338651);
    a=ii(a,b,c,d,m[0],6,-198630844);    d=ii(d,a,b,c,m[7],10,1126891415);
    c=ii(c,d,a,b,m[14],15,-1416354905); b=ii(b,c,d,a,m[5],21,-57434055);
    a=ii(a,b,c,d,m[12],6,1700485571);   d=ii(d,a,b,c,m[3],10,-1894986606);
    c=ii(c,d,a,b,m[10],15,-1051523);    b=ii(b,c,d,a,m[1],21,-2054922799);
    a=ii(a,b,c,d,m[8],6,1873313359);    d=ii(d,a,b,c,m[15],10,-30611744);
    c=ii(c,d,a,b,m[6],15,-1560198380);  b=ii(b,c,d,a,m[13],21,1309151649);
    a=ii(a,b,c,d,m[4],6,-145523070);    d=ii(d,a,b,c,m[11],10,-1120210379);
    c=ii(c,d,a,b,m[2],15,718787259);    b=ii(b,c,d,a,m[9],21,-343485551);
    a=safeAdd(a,aa); b=safeAdd(b,bb); c=safeAdd(c,cc); d=safeAdd(d,dd);
  }
  return [a,b,c,d].map(x => {
    x = x >>> 0;
    return Array.from({length:4}, (_,i) => ('0'+((x>>(i*8))&0xff).toString(16)).slice(-2)).join('');
  }).join('');
}

// ── PHP urlencode() compatible encoding — matches PayFast signature ──
function pfEncode(str) {
  return encodeURIComponent(String(str).trim())
    .replace(/%20/g, '+')
    .replace(/!/g,   '%21')
    .replace(/'/g,   '%27')
    .replace(/\(/g,  '%28')
    .replace(/\)/g,  '%29')
    .replace(/\*/g,  '%2A')
    .replace(/~/g,   '%7E');
}

// ── Build PayFast signature string and MD5 hash ───────────────────
// Confirmed from official PayFast PHP SDK source (Auth.php generateSignature):
// Fields are output in CANONICAL ORDER (the fixed list below), NOT alphabetically.
// Passphrase is appended at the END after all fields.
const PF_FIELD_ORDER = [
  'merchant_id','merchant_key','return_url','cancel_url','notify_url','notify_method',
  'name_first','name_last','email_address','cell_number',
  'm_payment_id','amount','item_name','item_description',
  'custom_int1','custom_int2','custom_int3','custom_int4','custom_int5',
  'custom_str1','custom_str2','custom_str3','custom_str4','custom_str5',
  'email_confirmation','confirmation_address','currency','payment_method',
  'subscription_type','billing_date','recurring_amount','frequency','cycles',
  'subscription_notify_email','subscription_notify_webhook','subscription_notify_buyer'
];
function buildPfSigStr(params, passphrase) {
  const pairs = [];
  for (const k of PF_FIELD_ORDER) {
    if (k in params) {
      const val = String(params[k]).trim();
      if (val !== '') pairs.push(`${k}=${pfEncode(val)}`);
    }
  }
  if (passphrase) pairs.push('passphrase=' + pfEncode(passphrase.trim()));
  return pairs.join('&');
}
function buildPfSignature(params, passphrase) {
  return md5hex(buildPfSigStr(params, passphrase));
}

// Secrets are injected via Cloudflare environment variables (env.GAS_SECRET, env.IMGBB_KEY)
// Set these in: Cloudflare Dashboard → Worker → Settings → Variables (use Encrypted type)

const CORS = {
  'Access-Control-Allow-Origin':  'https://innovat3.co.za',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-IN3-Key',
  'Access-Control-Max-Age':       '86400',
};

// ── Rate limiter using Cloudflare Cache API ───────────────────────
async function checkRateLimit(ip, route, limit, windowSecs) {
  const key = `rate:${route}:${ip}`;
  const cache = caches.default;
  const cacheKey = new Request(`https://innovat3-rate-limit.internal/${key}`);
  const cached = await cache.match(cacheKey);
  const hits = cached ? parseInt(await cached.text()) : 0;
  if (hits >= limit) return false;
  await cache.put(cacheKey, new Response(String(hits + 1), {
    headers: { 'Cache-Control': `max-age=${windowSecs}` }
  }));
  return true;
}

// ── Demo register handler ─────────────────────────────────────────
async function handleDemoRegister(request, ip, secret) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ status: 'error', message: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Rate limit: 10 demo registrations per IP per hour
  const allowed = await checkRateLimit(ip, 'demo-register', 10, 3600);
  if (!allowed) return new Response(
    JSON.stringify({ status: 'error', message: 'Too many requests. Please try again later.' }),
    { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Validate required fields
  if (!data.tagId || !data.firstName || !data.email) {
    return new Response(JSON.stringify({ status: 'error', message: 'Missing required fields' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Enforce demo tag ID format
  if (!data.tagId.startsWith('IN3-DEMO-')) {
    return new Response(JSON.stringify({ status: 'error', message: 'Invalid demo tag ID format' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Sanitise text fields
  function sanitise(val) {
    if (typeof val !== 'string') return val;
    return val.replace(/<[^>]*>/g, '').substring(0, 1000);
  }

  const clean = {
    action:           'demoRegister',
    tagId:            sanitise(data.tagId),
    timestamp:        new Date().toISOString(),
    firstName:        sanitise(data.firstName        || ''),
    lastName:         sanitise(data.lastName         || ''),
    dob:              sanitise(data.dob              || ''),
    email:            sanitise(data.email            || ''),
    phone:            sanitise(data.phone            || ''),
    telegram:         sanitise(data.telegram         || ''),
    idNumber:         sanitise(data.idNumber         || ''),
    deliveryAddress:  sanitise(data.deliveryAddress  || ''),
    bloodType:        sanitise(data.bloodType        || ''),
    conditions:       sanitise(data.conditions       || ''),
    medications:      sanitise(data.medications      || ''),
    medicalAid:       sanitise(data.medicalAid       || ''),
    medicalAidNumber: sanitise(data.medicalAidNumber || ''),
    address:          sanitise(data.address          || ''),
    notes:            sanitise(data.notes            || ''),
    photoUrl:         sanitise(data.photoUrl         || ''),
    contacts:         (data.contacts || []).slice(0, 3).map(c => ({
      name:     sanitise(c.name     || ''),
      rel:      sanitise(c.rel      || ''),
      phone:    sanitise(c.phone    || ''),
      wa:       Boolean(c.wa),
      telegram: sanitise(c.telegram || '')
    })),
    consentDate: new Date().toISOString(),
    plan:        'Demo',
    _secret:     secret
  };

  try {
    const gasResp = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
      body:    JSON.stringify(clean)
    });
    return new Response(await gasResp.text(), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ status: 'error', message: 'Backend unavailable' }), {
      status: 503, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}

// ── Photo upload handler — proxies to imgbb, keeps API key server-side ──
async function handlePhotoUpload(request, ip, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const allowed = await checkRateLimit(ip, 'upload-photo', 20, 3600);
  if (!allowed) return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
    status: 429, headers: { ...CORS, 'Content-Type': 'application/json' }
  });

  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const image = formData.get('image');
  if (!image) {
    return new Response(JSON.stringify({ error: 'No image provided' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Block oversized payloads (10MB limit)
  const imageStr = typeof image === 'string' ? image : '';
  if (imageStr.length > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'Image too large (max 10MB)' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const imgbbKey = env.IMGBB_KEY;
  if (!imgbbKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  try {
    const fd = new FormData();
    fd.append('image', image);
    const imgbbResp = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
      method: 'POST',
      body: fd
    });
    const imgbbJson = await imgbbResp.json();
    if (imgbbJson.success && imgbbJson.data && imgbbJson.data.url) {
      return new Response(JSON.stringify({ success: true, url: imgbbJson.data.url }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: 'Upload failed' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Upload service unavailable' }), {
      status: 503, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}

// ── Input sanitiser ───────────────────────────────────────────────
function sanitiseField(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/<[^>]*>/g, '').substring(0, 1000);
}

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url    = new URL(request.url);
    const path   = url.pathname;
    const ip     = request.headers.get('CF-Connecting-IP') || 'unknown';
    const secret = env.GAS_SECRET;
    const imgbbKey = env.IMGBB_KEY;

    if (!secret) {
      return new Response(JSON.stringify({ error: 'Server misconfigured: missing GAS_SECRET' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    // ── /scan ─────────────────────────────────────────────────────
    if (path === '/scan') {
      // Rate limit: 30 scans per IP per hour (prevents scraping)
      const allowed = await checkRateLimit(ip, 'scan', 30, 3600);
      if (!allowed) return new Response(
        JSON.stringify({ status: 'error', message: 'Rate limit exceeded' }),
        { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );

      try {
        const gasUrl = new URL(GAS_URL);
        gasUrl.searchParams.set('action', 'scan');
        let params = {};
        if (request.method === 'POST') {
          try { params = await request.json(); } catch(e) {}
        } else {
          url.searchParams.forEach((v, k) => { params[k] = v; });
        }
        Object.entries(params).forEach(([k, v]) => {
          if (k !== 'action') gasUrl.searchParams.set(k, v);
        });
        const gasResp = await fetch(gasUrl.toString(), {
          method: 'GET',
          headers: { 'User-Agent': 'innovat3-worker/1.0' },
        });
        return new Response(await gasResp.text(), {
          status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch(err) {
        return new Response(JSON.stringify({ status: 'error', message: err.message }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── /register ─────────────────────────────────────────────────
    if (path === '/register') {
      // Rate limit: 5 registrations per IP per hour
      const allowed = await checkRateLimit(ip, 'register', 5, 3600);
      if (!allowed) return new Response(
        JSON.stringify({ status: 'error', message: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );

      try {
        let body = {};
        try { body = await request.json(); } catch(e) {}

        // Validate required fields
        if (!body.firstName || !body.email) {
          return new Response(JSON.stringify({ status: 'error', message: 'Missing required fields' }), {
            status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
          });
        }

        // Sanitise all string fields
        Object.keys(body).forEach(k => {
          if (typeof body[k] === 'string') body[k] = sanitiseField(body[k]);
        });

        body.type = body.type || 'REGISTRATION';
        // Inject secret key so GAS can verify request came from Worker
        body._secret = secret;

        const gasUrl = new URL(GAS_URL);
        const gasResp = await fetch(gasUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
          body: JSON.stringify(body)
        });
        return new Response(await gasResp.text(), {
          status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch(err) {
        return new Response(JSON.stringify({ status: 'error', message: err.message }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── /demo-register ────────────────────────────────────────────
    if (path === '/demo-register') {
      return handleDemoRegister(request, ip, secret);
    }

    // ── /prepare-payment — generates PayFast signature in-worker ──
    if (path === '/prepare-payment') {
      try {
        const body = await request.json();
        const pfParams = body.pfParams;
        if (!pfParams) return new Response(JSON.stringify({ status: 'error', message: 'Missing pfParams' }),
          { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

        // Store registration data in KV keyed by tagId — /itn reads this after payment
        const regData = body.regData;
        const tagId   = pfParams.m_payment_id;
        if (regData && tagId && env.Kv) {
          await env.Kv.put('reg_' + tagId, JSON.stringify(regData), { expirationTtl: 86400 });
        }

        // Generate signature — passphrase appended at end (official PayFast method).
        const passphrase = (env.PF_PASSPHRASE || '').trim();
        const sigStr    = buildPfSigStr(pfParams, passphrase);
        const signature = md5hex(sigStr);
        return new Response(JSON.stringify({ status: 'ok', signature, sigStr }), {
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', message: 'Failed: ' + e.message }),
          { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }

    // ── /itn — PayFast Instant Transaction Notification ───────────
    if (path === '/itn') {
      try {
        const rawBody = await request.text();

        // Parse URL-encoded body, preserving field order for signature verification
        const itnParams = {};
        const orderedPairs = [];
        rawBody.split('&').forEach(pair => {
          const eqIdx = pair.indexOf('=');
          if (eqIdx === -1) return;
          const k = decodeURIComponent(pair.substring(0, eqIdx));
          const v = decodeURIComponent(pair.substring(eqIdx + 1).replace(/\+/g, ' '));
          itnParams[k] = v;
          if (k !== 'signature') orderedPairs.push(`${k}=${pfEncode(v)}`);
        });

        // Verify PayFast signature — passphrase appended at end (official PayFast method).
        const itnPassphrase = (env.PF_PASSPHRASE || '').trim();
        const expectedSig = buildPfSignature(itnParams, itnPassphrase);
        const receivedSig = itnParams.signature || '';

        if (expectedSig !== receivedSig) {
          console.log('ITN signature mismatch. expected=' + expectedSig + ' got=' + receivedSig);
          return new Response('OK', { status: 200 });
        }

        if (itnParams.payment_status !== 'COMPLETE') {
          return new Response('OK', { status: 200 });
        }

        // Retrieve registration data from KV
        const rawPaymentId = itnParams.m_payment_id || '';
        const isManualRenew = rawPaymentId.startsWith('RENEW-');
        const tagId        = isManualRenew ? rawPaymentId.slice(6) : rawPaymentId; // strip 'RENEW-' prefix
        const isRenewal    = !!(itnParams.subscription_id) || isManualRenew;
        let regData = null;
        if (tagId && env.Kv) {
          const kvVal = await env.Kv.get('reg_' + tagId);
          if (kvVal) { try { regData = JSON.parse(kvVal); } catch(e) {} }
        }

        if (isRenewal && !regData) {
          // Recurring monthly charge — just extend expiry in GAS, no new row needed
          await fetch(GAS_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
            body:    JSON.stringify({
              type:          'RENEWAL',
              _secret:       secret,
              tagId:         tagId,
              paymentAmount: itnParams.amount_gross   || '',
              payFastRef:    itnParams.pf_payment_id  || '',
              subscriptionId:itnParams.subscription_id || ''
            })
          });
        } else if (regData) {
          // Normalise field names: frontend uses blood/medical/meds, GAS expects bloodType/conditions/medications
          if (regData.blood     && !regData.bloodType)   regData.bloodType   = regData.blood;
          if (regData.medical   && !regData.conditions)  regData.conditions  = regData.medical;
          if (regData.meds      && !regData.medications) regData.medications = regData.meds;
          if (regData.colour    && !regData.colours)     regData.colours     = regData.colour;
          if (regData.medicalAidNumber && !regData.medAidNo) regData.medAidNo = regData.medicalAidNumber;
          // Flatten contacts array → c1Name, c1Rel, c1Phone, c1WA, c1TG, etc.
          if (Array.isArray(regData.contacts)) {
            regData.contacts.forEach((c, i) => {
              if (!c) return;
              const n = i + 1;
              regData[`c${n}Name`]  = c.name     || '';
              regData[`c${n}Rel`]   = c.rel      || '';
              regData[`c${n}Phone`] = c.phone    || '';
              regData[`c${n}WA`]    = c.wa       ? 'Yes' : '';
              regData[`c${n}TG`]    = c.telegram || '';
            });
            delete regData.contacts;
          }

          // Save full registration to GAS as Active
          const payload = Object.assign({}, regData, {
            type:          'REGISTRATION',
            status:        'Active',
            _secret:       secret,
            paymentStatus: 'COMPLETE',
            paymentAmount: itnParams.amount_gross || '',
            payFastRef:    itnParams.pf_payment_id || ''
          });
          await fetch(GAS_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
            body:    JSON.stringify(payload)
          });
          // Clean up KV
          if (env.Kv) await env.Kv.delete('reg_' + tagId);

        } else {
          // KV data missing for a new registration — send what PayFast gave us so GAS can
          // at least create a stub row and alert owner via Telegram to follow up manually.
          console.log('ITN: no KV data for tagId=' + tagId + ' — sending stub to GAS');
          await fetch(GAS_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
            body:    JSON.stringify({
              type:          'REGISTRATION',
              status:        'Pending — KV Missing',
              _secret:       secret,
              tagId:         tagId,
              firstName:     itnParams.name_first      || '',
              lastName:      itnParams.name_last        || '',
              email:         itnParams.email_address    || '',
              paymentStatus: 'COMPLETE',
              paymentAmount: itnParams.amount_gross     || '',
              payFastRef:    itnParams.pf_payment_id    || '',
              plan:          itnParams.item_name        || ''
            })
          });
        }

        return new Response('OK', { status: 200 });
      } catch(e) {
        console.log('ITN error:', e.message);
        return new Response('OK', { status: 200 }); // Always 200 to PayFast
      }
    }

    // ── /upload-photo — proxies image to imgbb server-side ────────
    if (path === '/upload-photo') {
      return handlePhotoUpload(request, ip, env);
    }

    // ── /update-photo — updates photo URL on registration after payment ──
    if (path === '/update-photo') {
      try {
        const body = await request.json();
        const tagId    = String(body.tagId    || '').trim();
        const photoUrl = String(body.photoUrl || '').trim();
        if (!tagId || !photoUrl) {
          return new Response(JSON.stringify({ status: 'error', message: 'Missing tagId or photoUrl' }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const gasUrl = `${GAS_URL}?action=updatePhoto&tagId=${encodeURIComponent(tagId)}&photoUrl=${encodeURIComponent(photoUrl)}&_secret=${encodeURIComponent(secret)}`;
        const gasRes = await fetch(gasUrl);
        const gasJson = await gasRes.json();
        return new Response(JSON.stringify(gasJson), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', message: 'Update failed' }),
          { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }

    // ── /waitlist ─────────────────────────────────────────────────
    if (path === '/waitlist') {
      // Rate limit: 3 waitlist signups per IP per hour
      const allowed = await checkRateLimit(ip, 'waitlist', 3, 3600);
      if (!allowed) return new Response(
        JSON.stringify({ status: 'error', message: 'Too many requests.' }),
        { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );

      try {
        let body = {};
        try { body = await request.json(); } catch(e) {}
        body.type    = 'WAITLIST';
        body._secret = secret;

        const gasUrl = new URL(GAS_URL);
        const gasResp = await fetch(gasUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
          body: JSON.stringify(body)
        });
        return new Response(await gasResp.text(), {
          status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch(err) {
        return new Response(JSON.stringify({ status: 'error', message: err.message }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── /verify-tag — reactivation: check tag exists + email matches ─
    if (path === '/verify-tag') {
      const tagId = url.searchParams.get('tagId') || '';
      const email = (url.searchParams.get('email') || '').toLowerCase().trim();
      if (!tagId || !email) return new Response(
        JSON.stringify({ status: 'error', message: 'Missing tagId or email' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
      try {
        const gasUrl = new URL(GAS_URL);
        gasUrl.searchParams.set('action', 'verifyTag');
        gasUrl.searchParams.set('tagId', tagId);
        gasUrl.searchParams.set('email', email);
        gasUrl.searchParams.set('_secret', secret);
        const gasResp = await fetch(gasUrl.toString(), { headers: { 'User-Agent': 'innovat3-worker/1.0' } });
        return new Response(await gasResp.text(), {
          status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch(err) {
        return new Response(JSON.stringify({ status: 'error', message: err.message }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── /gas — profile fetch ──────────────────────────────────────
    if (path === '/gas') {
      // Rate limit: 60 profile fetches per IP per hour
      const allowed = await checkRateLimit(ip, 'gas', 60, 3600);
      if (!allowed) return new Response(
        JSON.stringify({ status: 'error', message: 'Rate limit exceeded' }),
        { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );

      try {
        const gasUrl = new URL(GAS_URL);
        url.searchParams.forEach((v, k) => { gasUrl.searchParams.set(k, v); });
        const gasResp = await fetch(gasUrl.toString(), {
          method: 'GET',
          headers: { 'User-Agent': 'innovat3-worker/1.0' },
        });
        return new Response(await gasResp.text(), {
          status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch(err) {
        return new Response(JSON.stringify({ status: 'error', message: err.message }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── /admin — dashboard data fetch ────────────────────────────
    if (path === '/admin') {
      // Only allow exact origin match — substring checks are bypassable
      const origin = request.headers.get('Origin') || '';
      if (origin !== 'https://innovat3.co.za') {
        return new Response(JSON.stringify({ status: 'error', message: 'Forbidden' }), {
          status: 403, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      const sheet = url.searchParams.get('sheet') || '';
      const ALLOWED_ADMIN_SHEETS = ['Registrations', 'Scan Logs', 'Payments', 'Waitlist', 'Demo Registrations', 'Demo Scan Logs', 'Telegram Chat IDs', 'Family Bundles'];
      if (!sheet || ALLOWED_ADMIN_SHEETS.indexOf(sheet) === -1) return new Response(
        JSON.stringify({ status: 'error', message: 'Invalid or missing sheet param' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
      try {
        const gasUrl = new URL(GAS_URL);
        gasUrl.searchParams.set('action', 'adminData');
        gasUrl.searchParams.set('sheet', sheet);
        gasUrl.searchParams.set('adminSecret', secret);
        const gasResp = await fetch(gasUrl.toString(), {
          method: 'GET',
          redirect: 'follow',
          headers: { 'User-Agent': 'innovat3-worker/1.0' },
        });
        const text = await gasResp.text();
        // Validate it's actually JSON before returning
        try { JSON.parse(text); } catch(e) {
          return new Response(JSON.stringify({ status: 'error', message: 'GAS returned non-JSON: ' + text.substring(0, 100) }), {
            status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
          });
        }
        return new Response(text, {
          status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch(err) {
        return new Response(JSON.stringify({ status: 'error', message: err.message }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── /itn-test — simulate ITN without real payment (no sig check) ─
    if (path === '/itn-test') {
      try {
        const body = await request.json();
        const tagId = body.tagId || '';
        if (!tagId) return new Response(JSON.stringify({ status: 'error', message: 'Missing tagId' }),
          { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

        let regData = null;
        if (env.Kv) {
          const kvVal = await env.Kv.get('reg_' + tagId);
          if (kvVal) { try { regData = JSON.parse(kvVal); } catch(e) {} }
        }

        if (!regData) return new Response(JSON.stringify({ status: 'error', message: 'No regData found in KV for tag: ' + tagId }),
          { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

        if (regData.blood     && !regData.bloodType)   regData.bloodType   = regData.blood;
        if (regData.medical   && !regData.conditions)  regData.conditions  = regData.medical;
        if (regData.meds      && !regData.medications) regData.medications = regData.meds;
        if (regData.colour    && !regData.colours)     regData.colours     = regData.colour;
        if (regData.medicalAidNumber && !regData.medAidNo) regData.medAidNo = regData.medicalAidNumber;
        if (Array.isArray(regData.contacts)) {
          regData.contacts.forEach((c, i) => {
            if (!c) return;
            const n = i + 1;
            regData[`c${n}Name`]  = c.name || '';
            regData[`c${n}Rel`]   = c.rel  || '';
            regData[`c${n}Phone`] = c.phone || '';
            regData[`c${n}WA`]    = c.wa ? 'Yes' : '';
            regData[`c${n}TG`]    = c.telegram || '';
          });
          delete regData.contacts;
        }

        const payload = Object.assign({}, regData, {
          type: 'REGISTRATION', status: 'Active', _secret: secret,
          paymentStatus: 'COMPLETE', paymentAmount: body.amount_gross || '0',
          payFastRef: body.pf_payment_id || 'TEST'
        });

        const gasResp = await fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
          body: JSON.stringify(payload)
        });
        const gasText = await gasResp.text();
        if (env.Kv) await env.Kv.delete('reg_' + tagId);
        return new Response(JSON.stringify({ status: 'ok', gasResponse: gasText }),
          { headers: { ...CORS, 'Content-Type': 'application/json' } });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }),
          { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }

    // ── /test-sig — verify MD5 + passphrase loading ──────────────
    if (path === '/test-sig') {
      const passphrase = env.PF_PASSPHRASE || '';

      // Known MD5 values to verify our MD5 implementation is correct
      const md5_of_abc        = md5hex('abc');        // must be: 900150983cd24fb0d6963f7d28e17f72
      const md5_of_test       = md5hex('test');       // must be: 098f6bcd4621d373cade4e832627b4f6
      const md5_of_passphrase = md5hex(passphrase);   // user can verify via any online MD5 tool

      const testParams = {
        merchant_id:   '34168603',
        merchant_key:  'frbiyqgqpun0a',
        return_url:    'https://innovat3.co.za/success.html',
        cancel_url:    'https://innovat3.co.za/register/',
        notify_url:    'https://api.innovat3.co.za/itn',
        m_payment_id:  'IN3-TEST-001',
        amount:        '249.00',
        item_name:     'Innovat3 Solo Annual'
      };
      // Signature WITH passphrase
      const sigPairsWith = [];
      for (const k of Object.keys(testParams).sort()) {
        sigPairsWith.push(`${k}=${pfEncode(String(testParams[k]).trim())}`);
      }
      if (passphrase) sigPairsWith.push('passphrase=' + pfEncode(passphrase.trim()));
      const sigStrWith = sigPairsWith.join('&');
      const sigWith    = md5hex(sigStrWith);

      // Signature WITHOUT passphrase (old behaviour — to compare)
      const sigPairsNo = [];
      for (const k of Object.keys(testParams).sort()) {
        sigPairsNo.push(`${k}=${pfEncode(String(testParams[k]).trim())}`);
      }
      const sigStrNo = sigPairsNo.join('&');
      const sigNo    = md5hex(sigStrNo);

      return new Response(JSON.stringify({
        status:             'ok',
        // MD5 self-test — verify these match known values
        md5_abc_expected:   '900150983cd24fb0d6963f7d28e17f72',
        md5_abc_actual:     md5_of_abc,
        md5_abc_ok:         md5_of_abc === '900150983cd24fb0d6963f7d28e17f72',
        md5_test_expected:  '098f6bcd4621d373cade4e832627b4f6',
        md5_test_actual:    md5_of_test,
        md5_test_ok:        md5_of_test === '098f6bcd4621d373cade4e832627b4f6',
        // Passphrase info
        passphraseSet:      passphrase.length > 0,
        passphraseLen:      passphrase.length,
        md5_of_passphrase:  md5_of_passphrase,  // check this vs online MD5 tool with your passphrase
        // Signatures
        sigWith:            sigWith,
        sigStrWith:         sigStrWith,
        sigNo:              sigNo,
        sigStrNo:           sigStrNo
      }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // ── /test-payment-page — ready-to-submit PayFast diagnostic form ─
    if (path === '/test-payment-page') {
      const passphrase = (env.PF_PASSPHRASE || '').trim();
      // Unique ID each load — prevents duplicate m_payment_id rejections
      const uid = 'IN3-T-' + Date.now();
      const testParams = {
        merchant_id:   '34168603',
        merchant_key:  'frbiyqgqpun0a',
        return_url:    'https://innovat3.co.za/success.html',
        cancel_url:    'https://innovat3.co.za/register/',
        notify_url:    'https://api.innovat3.co.za/itn',
        m_payment_id:  uid,
        amount:        '5.00',
        item_name:     'Innovat3 Sig Test',
        name_first:    'Test',
        name_last:     'User',
        email_address: 'test@innovat3.co.za'
      };

      // A: passphrase SORTED alphabetically with all fields (p between n and r)
      const sigStrA = buildPfSigStr(testParams, passphrase);
      const sigA    = md5hex(sigStrA);

      // B: passphrase appended at END after all fields
      const pairsB = [];
      for (const k of Object.keys(testParams).sort()) {
        pairsB.push(`${k}=${pfEncode(String(testParams[k]).trim())}`);
      }
      if (passphrase) pairsB.push('passphrase=' + pfEncode(passphrase));
      const sigStrB = pairsB.join('&');
      const sigB    = md5hex(sigStrB);

      // C: no passphrase
      const pairsC = [];
      for (const k of Object.keys(testParams).sort()) {
        pairsC.push(`${k}=${pfEncode(String(testParams[k]).trim())}`);
      }
      const sigStrC = pairsC.join('&');
      const sigC    = md5hex(sigStrC);

      function mkInputs(params, sig) {
        return Object.entries(Object.assign({}, params, { signature: sig }))
          .map(([k,v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g,'&quot;')}">`).join('');
      }

      const md5ok = md5hex('abc') === '900150983cd24fb0d6963f7d28e17f72';
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PayFast Sig Test</title>
<style>
body{font-family:monospace;background:#0a0a0a;color:#e0e0e0;padding:20px;max-width:900px;margin:0 auto}
h2{color:#F97316}h3{color:#0ED2C8;margin:16px 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase}
.ok{color:#22c55e;background:rgba(34,197,94,0.1);border:1px solid #22c55e;border-radius:6px;padding:8px 12px;margin:6px 0;font-size:12px}
.warn{color:#ef4444;background:rgba(239,68,68,0.1);border:1px solid #ef4444;border-radius:6px;padding:8px 12px;margin:6px 0;font-size:12px}
.box{background:#050505;border:1px solid #444;border-radius:6px;padding:10px;word-break:break-all;font-size:11px;color:#ccc;margin:6px 0;line-height:1.7}
.sig{color:#22c55e;font-size:14px;letter-spacing:1px;font-weight:bold}
.section{background:#141414;border:1px solid #333;border-radius:8px;padding:14px;margin-bottom:14px}
button{border:none;border-radius:6px;padding:11px 22px;font-size:13px;font-weight:700;cursor:pointer;margin:6px 4px 0 0}
.btnA{background:#F97316;color:#fff}.btnB{background:#1e3a5f;border:1px solid #3B82F6;color:#60a5fa}
.btnC{background:#1a1a1a;border:1px solid #666;color:#aaa}
.key{color:#F97316;font-weight:bold}
</style></head><body>
<h2>🧪 PayFast Signature Test — 3 Variants</h2>
<p style="color:#666;font-size:11px">m_payment_id: ${uid} (unique per page load — no duplicate ID issue)</p>

<div class="section">
<div class="${md5ok?'ok':'warn'}">${md5ok?'✓ MD5 correct':'✗ MD5 BROKEN'}</div>
<div class="${passphrase?'ok':'warn'}">${passphrase?`✓ Passphrase loaded: "${passphrase}" (${passphrase.length} chars) MD5=${md5hex(passphrase)}`:'✗ PF_PASSPHRASE not set'}</div>
</div>

<div class="section">
<h3>🅐 Passphrase SORTED ALPHABETICALLY (passphrase between notify_url &amp; return_url)</h3>
<p style="color:#888;font-size:11px">This is the fix — PayFast SDK adds passphrase to params BEFORE ksort, not after.</p>
<div class="box">${sigStrA}</div>
<p style="font-size:12px">Signature: <span class="sig">${sigA}</span></p>
<p style="color:#ef4444;font-size:11px">⚠️ R5.00 real charge if it works</p>
<form method="post" action="https://www.payfast.co.za/eng/process" style="display:inline">
  ${mkInputs(testParams, sigA)}
  <button type="submit" class="btnA">Submit A (SORTED passphrase) →</button>
</form>
</div>

<div class="section">
<h3>🅑 Passphrase APPENDED AT END (old approach)</h3>
<div class="box">${sigStrB}</div>
<p style="font-size:12px">Signature: <span class="sig">${sigB}</span></p>
<form method="post" action="https://www.payfast.co.za/eng/process" style="display:inline">
  ${mkInputs(testParams, sigB)}
  <button type="submit" class="btnB">Submit B (END passphrase) →</button>
</form>
</div>

<div class="section">
<h3>🅒 No Passphrase (should fail — useful as baseline)</h3>
<div class="box">${sigStrC}</div>
<p style="font-size:12px">Signature: <span class="sig">${sigC}</span></p>
<form method="post" action="https://www.payfast.co.za/eng/process" style="display:inline">
  ${mkInputs(testParams, sigC)}
  <button type="submit" class="btnC">Submit C (NO passphrase) →</button>
</form>
</div>

<p style="color:#444;font-size:11px;margin-top:20px">If A works → PayFast sorts passphrase alphabetically. If B works → PayFast appends at end. If C works → PayFast ignores the passphrase setting.</p>
</body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    // ── /cash-register — proxies admin cash registration to GAS ─────
    // Admin page CSP only allows api.innovat3.co.za, so direct GAS fetch is blocked.
    if (path === '/cash-register') {
      try {
        let body = '';
        try { body = await request.text(); } catch(e) {}
        const gasResp = await fetch(GAS_URL, {
          method:  'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
          body:    body
        });
        const text = await gasResp.text();
        return new Response(text, {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
          status: 500,
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── /telegram — Telegram webhook proxy ───────────────────────
    // Telegram POSTs directly to GAS but GAS redirects and drops the body (401).
    // This route accepts the POST from Telegram and forwards it to GAS correctly.
    if (path === '/telegram') {
      try {
        let body = '';
        try { body = await request.text(); } catch(e) {}
        const gasResp = await fetch(GAS_URL, {
          method:   'POST',
          redirect: 'follow',
          headers:  { 'Content-Type': 'application/json', 'User-Agent': 'innovat3-worker/1.0' },
          body:     body
        });
        return new Response(await gasResp.text(), { status: 200 });
      } catch(e) {
        return new Response('ok', { status: 200 });
      }
    }

    // ── /health ───────────────────────────────────────────────────
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'innovat3-worker', version: '3.2' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    return new Response('innovat3 API', { status: 200, headers: CORS });
  }
};
