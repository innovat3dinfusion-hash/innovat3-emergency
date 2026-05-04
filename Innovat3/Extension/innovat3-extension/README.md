# innovat3 Deploy Dashboard — Chrome Extension

## Install on Each Computer (30 seconds)

1. Download the `innovat3-extension` folder to your computer
2. Open Chrome → go to `chrome://extensions`
3. Turn on **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `innovat3-extension` folder
6. The IN3 icon appears in your Chrome toolbar — pin it by clicking the puzzle piece icon

## First Time Setup

1. Click the IN3 icon in Chrome toolbar
2. Go to **Credentials** tab
3. Paste your GitHub token → Save
4. Paste your Cloudflare token → Save

## Loading File Content (first time + after Claude fixes)

Open Chrome DevTools console (F12) on any page and run:

```javascript
// Load card page
fetch('https://raw.githubusercontent.com/innovat3dinfusion-hash/innovat3-emergency/main/card/index.html')
  .then(r=>r.text()).then(code => chrome.storage.local.set({in3_card: code}, ()=>console.log('card saved')));

// Load register page  
fetch('https://raw.githubusercontent.com/innovat3dinfusion-hash/innovat3-emergency/main/register/index.html')
  .then(r=>r.text()).then(code => chrome.storage.local.set({in3_register: code}, ()=>console.log('register saved')));
```

For Worker and GAS code — Claude will provide the content directly.

## Daily Use

When Claude makes a fix:
1. Claude tells you what changed
2. Click the IN3 icon
3. Click **Deploy All**
4. Done — GitHub and Cloudflare updated in seconds

## Credentials
- GitHub Token: stored in Chrome extension storage (encrypted)
- Cloudflare Token: stored in Chrome extension storage (encrypted)  
- Dashboard Password: Innovat3Deploy2026

## Two Computers
Install the extension on each computer separately.
Enter credentials once on each computer.
Both computers always deploy the same latest code.
