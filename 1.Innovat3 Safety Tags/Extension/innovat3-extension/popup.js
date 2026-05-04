// ═══════════════════════════════════════════════════════════════
// INNOVAT3 — Chrome Extension Deploy Dashboard
// popup.js — All deploy logic
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  GITHUB_REPO:    'innovat3dinfusion-hash/innovat3-emergency',
  GITHUB_BRANCH:  'main',
  CF_ACCOUNT_ID:  '71a24c1f465e8d0539eaa802136b7990',
  CF_WORKER_NAME: 'innovat3-api',
  RAW_BASE:       'https://raw.githubusercontent.com/innovat3dinfusion-hash/innovat3-emergency/main',
};

// ── TAB SWITCHING ─────────────────────────────────────────────────
function switchTab(name) {
  // Activate correct tab header
  ['deploy','gas','creds','log'].forEach(function(n) {
    var el = document.getElementById('tabn-' + n);
    if (el) el.classList.toggle('active', n === name);
  });
  // Activate correct panel
  document.querySelectorAll('.tab-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'tab-' + name);
  });
}

// ── LOGGING ───────────────────────────────────────────────────────
function log(type, msg) {
  const el = document.getElementById('log');
  const t = new Date().toLocaleTimeString('en-ZA');
  const line = document.createElement('div');
  line.className = 'll';
  line.innerHTML = `<span class="lt">${t}</span><span class="l${type}">${msg}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
function clearLog() { document.getElementById('log').innerHTML = ''; }

// ── CREDENTIALS ───────────────────────────────────────────────────
function saveCred(type) {
  const val = document.getElementById(type + 'Token').value.trim();
  if (!val) { setSt(type, 'Enter a token first', false); return; }
  chrome.storage.local.set({ ['in3_' + type]: val }, () => {
    document.getElementById(type + 'Token').value = '•'.repeat(24);
    setSt(type, '✓ Saved securely', true);
    log('ok', (type === 'gh' ? 'GitHub' : 'Cloudflare') + ' token saved');
  });
}
function clearCred(type) {
  chrome.storage.local.remove('in3_' + type, () => {
    document.getElementById(type + 'Token').value = '';
    setSt(type, 'Cleared', false);
  });
}
function setSt(type, msg, ok) {
  const el = document.getElementById(type + 'St');
  el.textContent = msg;
  el.className = 'field-status ' + (ok ? 'ok' : 'err');
}
function getToken(type) {
  return new Promise(res => {
    const val = document.getElementById(type + 'Token').value.trim();
    if (val && !val.startsWith('•')) { res(val); return; }
    chrome.storage.local.get('in3_' + type, d => res(d['in3_' + type] || ''));
  });
}

// ── GITHUB DEPLOY ─────────────────────────────────────────────────
async function deployGitHub() {
  const token = await getToken('gh');
  if (!token) { log('err', 'No GitHub token — go to Credentials tab'); switchTab('creds'); return; }

  setBtnLoading('btnGh', true);
  log('info', 'Fetching latest files from GitHub...');

  // Files to deploy: fetch from GitHub raw and re-push (ensures latest fixes)
  const files = [
    { path: 'card/index.html',     label: 'card/index.html' },
    { path: 'register/index.html', label: 'register/index.html' },
  ];

  // Also check if we have locally stored updated versions
  const stored = await new Promise(res => {
    chrome.storage.local.get(['in3_card', 'in3_register'], d => res(d));
  });

  let allOk = true;
  for (const file of files) {
    try {
      // Get current file SHA from GitHub
      const shaResp = await fetch(
        `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${file.path}`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
      );
      if (!shaResp.ok) throw new Error('Could not get file SHA: ' + shaResp.status);
      const shaData = await shaResp.json();

      // Use locally stored updated version if available, else skip (already up to date)
      const localKey = file.path === 'card/index.html' ? 'in3_card' : 'in3_register';
      const newContent = stored[localKey];

      if (!newContent) {
        log('warn', `${file.label} — no local update stored, skipping`);
        continue;
      }

      // Push to GitHub
      const pushResp = await fetch(
        `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${file.path}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `fix: update ${file.label} via innovat3 deploy dashboard`,
            content: btoa(unescape(encodeURIComponent(newContent))),
            sha: shaData.sha,
            branch: CONFIG.GITHUB_BRANCH
          })
        }
      );

      if (pushResp.ok) {
        log('ok', `✓ ${file.label} pushed`);
      } else {
        const err = await pushResp.json();
        throw new Error(err.message || 'Push failed');
      }
    } catch(e) {
      log('err', `✗ ${file.label}: ${e.message}`);
      allOk = false;
    }
  }

  setBtnLoading('btnGh', false);
  const badge = document.getElementById('badgeGh');
  if (allOk) {
    badge.textContent = '✓ ' + new Date().toLocaleTimeString('en-ZA');
    badge.className = 'badge-val ok';
    log('ok', '✓ GitHub deploy complete');
  } else {
    badge.textContent = '⚠ Errors';
    badge.className = 'badge-val';
    badge.style.color = 'var(--yellow)';
  }
  return allOk;
}

// ── CLOUDFLARE DEPLOY ─────────────────────────────────────────────
async function deployCloudflare() {
  const token = await getToken('cf');
  if (!token) { log('err', 'No Cloudflare token — go to Credentials tab'); switchTab('creds'); return; }

  const workerCode = await new Promise(res => {
    chrome.storage.local.get('in3_worker', d => res(d.in3_worker || ''));
  });

  if (!workerCode) {
    log('err', 'No Worker code stored — ask Claude to provide it');
    return;
  }

  setBtnLoading('btnCf', true);
  log('info', 'Deploying Cloudflare Worker...');

  try {
    const formData = new FormData();
    formData.append('metadata', JSON.stringify({
      main_module: 'worker.js',
      compatibility_date: '2024-01-01'
    }));
    formData.append(
      'worker.js',
      new Blob([workerCode], { type: 'application/javascript+module' }),
      'worker.js'
    );

    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CONFIG.CF_ACCOUNT_ID}/workers/scripts/${CONFIG.CF_WORKER_NAME}`,
      { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: formData }
    );
    const data = await resp.json();

    if (data.success) {
      log('ok', '✓ Cloudflare Worker deployed');
      const b = document.getElementById('badgeCf');
      b.textContent = '✓ ' + new Date().toLocaleTimeString('en-ZA');
      b.className = 'badge-val ok';
    } else {
      throw new Error(data.errors?.map(e => e.message).join(', ') || 'Deploy failed');
    }
  } catch(e) {
    log('err', `✗ Cloudflare: ${e.message}`);
    const b = document.getElementById('badgeCf');
    b.textContent = '✗ Failed';
    b.className = 'badge-val';
    b.style.color = 'var(--red)';
  }

  setBtnLoading('btnCf', false);
}

// ── DEPLOY ALL ────────────────────────────────────────────────────
async function deployAll() {
  log('info', '══ Full deployment started ══');
  document.getElementById('statusTxt').textContent = 'DEPLOYING';
  await deployGitHub();
  await deployCloudflare();
  document.getElementById('statusTxt').textContent = 'READY';
  log('info', '══ Deployment complete ══');
  switchTab('log');
}

// ── VERIFY LIVE ───────────────────────────────────────────────────
async function verifyLive() {
  log('info', 'Running health checks...');
  try {
    const r = await fetch('https://api.innovat3.co.za/health');
    const d = await r.json();
    if (d.status === 'ok') {
      log('ok', '✓ Cloudflare Worker responding');
      const b = document.getElementById('badgeLive');
      b.textContent = '✓ Online';
      b.className = 'badge-val ok';
    } else {
      log('warn', '⚠ Worker responded but status not ok');
    }
  } catch(e) {
    log('err', '✗ Health check failed: ' + e.message);
  }
  switchTab('log');
}

// ── GAS HELPERS ───────────────────────────────────────────────────
async function copyGas() {
  const code = await new Promise(res => {
    chrome.storage.local.get('in3_gas', d => res(d.in3_gas || ''));
  });
  if (!code) { log('err', 'No GAS code stored — ask Claude to load it'); return; }
  await navigator.clipboard.writeText(code);
  log('ok', '✓ GAS code copied to clipboard (' + Math.round(code.length/1024) + 'KB)');
}

function openGas() {
  chrome.tabs.create({ url: 'https://script.google.com/home' });
}

async function updateGasUrl() {
  const newUrl = document.getElementById('newGasUrl').value.trim();
  if (!newUrl || !newUrl.includes('script.google.com')) {
    log('err', 'Enter a valid GAS /exec URL first');
    return;
  }

  // Update stored worker code
  const worker = await new Promise(res => chrome.storage.local.get('in3_worker', d => res(d.in3_worker || '')));
  if (worker) {
    const updated = worker.replace(/const GAS_URL = '[^']+'/,  `const GAS_URL = '${newUrl}'`);
    chrome.storage.local.set({ in3_worker: updated });
    log('ok', '✓ Worker GAS_URL updated');
  }

  // Update stored register page notify_url
  const reg = await new Promise(res => chrome.storage.local.get('in3_register', d => res(d.in3_register || '')));
  if (reg) {
    const updated = reg.replace(/AKfycb[A-Za-z0-9_-]+\/exec/g, newUrl.replace('https://script.google.com/macros/s/', ''));
    chrome.storage.local.set({ in3_register: updated });
    log('ok', '✓ Register notify_url updated');
  }

  document.getElementById('badgeGas').textContent = '✓ URL updated';
  document.getElementById('badgeGas').className = 'badge-val ok';
  log('info', 'Now click Deploy All to push changes');
  switchTab('deploy');
}

// ── STORE FILE (called by Claude instructions) ────────────────────
// To store a file: open extension, go to console, run:
// chrome.storage.local.set({in3_card: '<file content>'})
// or use the storeFile helper below in background

// ── UTILS ─────────────────────────────────────────────────────────
function setBtnLoading(id, on) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Restore credential display
  chrome.storage.local.get(['in3_gh', 'in3_cf'], data => {
    if (data.in3_gh) {
      document.getElementById('ghToken').value = '•'.repeat(24);
      setSt('gh', '✓ Token loaded', true);
    }
    if (data.in3_cf) {
      document.getElementById('cfToken').value = '•'.repeat(24);
      setSt('cf', '✓ Token loaded', true);
    }
  });

  // Show stored file status
  chrome.storage.local.get(['in3_card','in3_register','in3_worker','in3_gas'], data => {
    const files = {in3_card:'card',in3_register:'register',in3_worker:'worker',in3_gas:'GAS'};
    Object.entries(files).forEach(([key, label]) => {
      if (data[key]) log('ok', `✓ ${label} code ready (${Math.round(data[key].length/1024)}KB)`);
      else log('warn', `${label} code not stored yet`);
    });
  });

  // ── Wire all event listeners here (CSP forbids inline onclick) ──
  // Tab navigation
  document.getElementById('tabn-deploy').addEventListener('click', () => switchTab('deploy'));
  document.getElementById('tabn-gas').addEventListener('click',    () => switchTab('gas'));
  document.getElementById('tabn-creds').addEventListener('click',  () => switchTab('creds'));
  document.getElementById('tabn-log').addEventListener('click',    () => switchTab('log'));

  // Deploy buttons
  document.getElementById('btnAll').addEventListener('click',    deployAll);
  document.getElementById('btnGh').addEventListener('click',     deployGitHub);
  document.getElementById('btnCf').addEventListener('click',     deployCloudflare);
  document.getElementById('btnVerify').addEventListener('click', verifyLive);

  // Credential buttons
  document.getElementById('btnSaveGh').addEventListener('click',  () => saveCred('gh'));
  document.getElementById('btnClearGh').addEventListener('click', () => clearCred('gh'));
  document.getElementById('btnSaveCf').addEventListener('click',  () => saveCred('cf'));
  document.getElementById('btnClearCf').addEventListener('click', () => clearCred('cf'));

  // GAS buttons
  document.getElementById('btnCopyGas').addEventListener('click',   copyGas);
  document.getElementById('btnOpenGas').addEventListener('click',   openGas);
  document.getElementById('btnUpdateGas').addEventListener('click', updateGasUrl);
  document.getElementById('btnClearLog').addEventListener('click',  clearLog);
});
