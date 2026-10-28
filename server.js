const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const ical = require('node-ical');
const WebSocket = require('ws');
require('dotenv').config();

const pkg = require('./package.json');
const { getLayout, saveLayout, resetLayout } = require('./server/layout-store');
const { getSources, getSource, saveSources, getSourcesDoc } = require('./server/sources-store');
const { listModules } = require('./server/module-meta');

const app = express();
const PORT = process.env.PORT || 1337;

app.use(express.json({ limit: '2mb' }));

const layoutClients = new Set();
function broadcastLayout(layout) {
  const payload = `data: ${JSON.stringify({ type: 'layout', updatedAt: layout.updatedAt })}\n\n`;
  for (const res of layoutClients) {
    try { res.write(payload); } catch { /* ignore */ }
  }
}

function editorAuth(req, res, next) {
  const token = process.env.EDITOR_TOKEN;
  if (!token) return next();
  const provided =
    req.get('x-editor-token') ||
    req.query.token ||
    (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (provided === token) return next();
  return res.status(401).json({ error: 'Unauthorized — set x-editor-token or ?token=' });
}

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  },
}));

app.get('/editor', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

app.get('/api/config', (_req, res) => {
  res.json({
    version: pkg.version,
    editorProtected: Boolean(process.env.EDITOR_TOKEN),
    refresh: {
      weather: (parseInt(process.env.REFRESH_WEATHER) || 600) * 1000,
      truenas: (parseInt(process.env.REFRESH_TRUENAS) || 30) * 1000,
      finance: (parseInt(process.env.REFRESH_FINANCE) || 300) * 1000,
      deliveries: (parseInt(process.env.REFRESH_DELIVERIES) || 900) * 1000,
      news: (parseInt(process.env.REFRESH_NEWS) || 1800) * 1000,
      calendar: (parseInt(process.env.REFRESH_CALENDAR) || 300) * 1000,
      network: (parseInt(process.env.REFRESH_NETWORK) || 60) * 1000,
      services: (parseInt(process.env.REFRESH_SERVICES) || 60) * 1000,
      qbit: (parseInt(process.env.REFRESH_QBIT) || 10) * 1000,
    },
    enabled: {
      stocks: process.env.ENABLE_STOCKS !== 'false',
      news: process.env.ENABLE_NEWS !== 'false',
      calendar: process.env.ENABLE_CALENDAR !== 'false',
      network: process.env.ENABLE_NETWORK !== 'false',
      deliveries: process.env.ENABLE_DELIVERIES !== 'false',
    },
  });
});

app.get('/api/layout', (_req, res) => {
  try { res.json(getLayout()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/layout', editorAuth, (req, res) => {
  try {
    if (!req.body || !Array.isArray(req.body.containers)) {
      return res.status(400).json({ error: 'Invalid layout: containers required' });
    }
    const saved = saveLayout(req.body);
    broadcastLayout(saved);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/layout/reset', editorAuth, (_req, res) => {
  try {
    const saved = resetLayout();
    broadcastLayout(saved);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/layout/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  layoutClients.add(res);
  req.on('close', () => layoutClients.delete(res));
});

app.get('/api/modules', (_req, res) => {
  res.json(listModules());
});

app.get('/api/sources', (_req, res) => {
  try { res.json(getSourcesDoc()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/sources', editorAuth, (req, res) => {
  try {
    const sources = req.body?.sources ?? req.body;
    if (!Array.isArray(sources)) {
      return res.status(400).json({ error: 'sources array required' });
    }
    res.json(saveSources(sources));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const WMO_DESCRIPTIONS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};

async function fetchWeather() {
  const lat = process.env.WEATHER_LAT;
  const lon = process.env.WEATHER_LON;
  if (!lat || !lon) return { error: 'Weather not configured' };
  const resp = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
  );
  const data = await resp.json();
  if (data.error) return { error: data.reason || 'API error' };
  const cur = data.current;
  const daily = data.daily;
  return {
    temp: Math.round(cur.temperature_2m),
    feels_like: Math.round(cur.apparent_temperature),
    high: Math.round(daily.temperature_2m_max[0]),
    low: Math.round(daily.temperature_2m_min[0]),
    humidity: cur.relative_humidity_2m,
    description: WMO_DESCRIPTIONS[cur.weather_code] || 'Unknown',
    weatherCode: cur.weather_code,
    isDay: cur.is_day,
  };
}

app.get('/api/weather', async (_req, res) => {
  try { res.json(await fetchWeather()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// TrueNAS — persistent JSON-RPC 2.0 over WebSocket (/api/current).
// REST /api/v2.0 is deprecated (alerts on use) and removed in 26.04.
// API keys require TLS (wss/https); plaintext auth auto-revokes the key.
// ---------------------------------------------------------------------------
const truenasState = {
  ws: null,
  ready: false,
  connecting: false,
  rpcId: 1,
  callbacks: new Map(),
  reconnectTimer: null,
  pingTimer: null,
  backoffMs: 1000,
  lastError: null,
  authFailed: false,
  cache: null,
  cacheAt: 0,
};

function truenasConfigured() {
  return Boolean(process.env.TRUENAS_HOST && process.env.TRUENAS_API_KEY);
}

function truenasWsUrl() {
  if (process.env.TRUENAS_WS_URL) return process.env.TRUENAS_WS_URL;

  const host = (process.env.TRUENAS_HOST || '').replace(/^https?:\/\//i, '');
  // Default https/wss — TrueNAS 25.10+ revokes API keys used over plaintext.
  const proto = (process.env.TRUENAS_PROTOCOL || 'https').toLowerCase();
  if (proto === 'http' || proto === 'ws') {
    console.error(
      'TrueNAS: refusing insecure protocol. Set TRUENAS_PROTOCOL=https (API keys over ws/http are auto-revoked).'
    );
    return null;
  }
  const wsProto = proto === 'https' || proto === 'wss' ? 'wss' : 'wss';
  return `${wsProto}://${host}/api/current`;
}

function truenasTlsOptions() {
  // Self-signed TrueNAS certs are normal; default to skip verify unless forced on.
  const raw = process.env.TRUENAS_TLS_REJECT_UNAUTHORIZED;
  const rejectUnauthorized = raw === 'true' || raw === '1';
  return { rejectUnauthorized, handshakeTimeout: 8000 };
}

function truenasClearTimers() {
  if (truenasState.reconnectTimer) {
    clearTimeout(truenasState.reconnectTimer);
    truenasState.reconnectTimer = null;
  }
  if (truenasState.pingTimer) {
    clearInterval(truenasState.pingTimer);
    truenasState.pingTimer = null;
  }
}

function truenasFailPending(err) {
  for (const [, cb] of truenasState.callbacks) {
    try { cb(undefined, err); } catch { /* ignore */ }
  }
  truenasState.callbacks.clear();
}

function truenasScheduleReconnect() {
  if (truenasState.reconnectTimer || !truenasConfigured() || truenasState.authFailed) return;
  const delay = truenasState.backoffMs;
  truenasState.backoffMs = Math.min(truenasState.backoffMs * 2, 60000);
  truenasState.reconnectTimer = setTimeout(() => {
    truenasState.reconnectTimer = null;
    truenasConnect();
  }, delay);
}

function truenasRpc(method, params = [], timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!truenasState.ready || !truenasState.ws || truenasState.ws.readyState !== WebSocket.OPEN) {
      return reject(new Error(truenasState.lastError || 'TrueNAS WebSocket not connected'));
    }
    const id = truenasState.rpcId++;
    const timer = setTimeout(() => {
      truenasState.callbacks.delete(id);
      reject(new Error(`TrueNAS RPC timeout: ${method}`));
    }, timeoutMs);
    truenasState.callbacks.set(id, (result, error) => {
      clearTimeout(timer);
      if (error) {
        const reason =
          (typeof error === 'object' && (error.data?.reason || error.message)) ||
          (typeof error === 'string' ? error : JSON.stringify(error));
        reject(new Error(reason));
      } else {
        resolve(result);
      }
    });
    try {
      truenasState.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
    } catch (err) {
      clearTimeout(timer);
      truenasState.callbacks.delete(id);
      reject(err);
    }
  });
}

async function truenasAuthenticate() {
  const key = process.env.TRUENAS_API_KEY;
  let authed = false;
  try {
    authed = (await truenasRpc('auth.login_with_api_key', [key], 10000)) === true;
  } catch (err) {
    truenasState.lastError = err.message;
    authed = false;
  }
  if (authed) return;

  const username = process.env.TRUENAS_USERNAME;
  if (!username) {
    throw new Error(
      'TrueNAS API key auth failed (key revoked/invalid?). Create a new user-linked API key and set TRUENAS_API_KEY. Optional: TRUENAS_USERNAME for login_ex fallback.'
    );
  }
  const login = await truenasRpc('auth.login_ex', [{
    mechanism: 'API_KEY_PLAIN',
    username,
    api_key: key,
    login_options: { user_info: false },
  }], 10000);
  if (!login || login.response_type !== 'SUCCESS') {
    throw new Error(`TrueNAS auth failed: ${login?.response_type || 'unknown'}`);
  }
}

function truenasConnect() {
  if (!truenasConfigured() || truenasState.connecting || truenasState.authFailed) return;
  if (truenasState.ws && (truenasState.ws.readyState === WebSocket.OPEN || truenasState.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = truenasWsUrl();
  if (!url) {
    truenasState.lastError = 'TrueNAS insecure protocol refused';
    return;
  }

  truenasState.connecting = true;
  truenasState.ready = false;
  truenasClearTimers();

  let ws;
  try {
    ws = new WebSocket(url, truenasTlsOptions());
  } catch (err) {
    truenasState.connecting = false;
    truenasState.lastError = err.message;
    truenasScheduleReconnect();
    return;
  }
  truenasState.ws = ws;

  ws.on('open', async () => {
    try {
      // Temporarily mark ready so auth RPCs can send.
      truenasState.ready = true;
      await truenasAuthenticate();
      truenasState.ready = true;
      truenasState.connecting = false;
      truenasState.authFailed = false;
      truenasState.backoffMs = 1000;
      truenasState.lastError = null;
      console.log(`TrueNAS WebSocket connected (${url})`);

      // Keepalive — middleware may drop idle sessions.
      truenasState.pingTimer = setInterval(() => {
        if (!truenasState.ready || !truenasState.ws || truenasState.ws.readyState !== WebSocket.OPEN) return;
        truenasRpc('core.ping', [], 5000).catch(() => {
          try { truenasState.ws.terminate(); } catch { /* ignore */ }
        });
      }, 30000);
    } catch (err) {
      truenasState.ready = false;
      truenasState.connecting = false;
      truenasState.lastError = err.message;
      truenasState.authFailed = /auth failed|revoked|invalid/i.test(err.message || '');
      console.error('TrueNAS auth error:', err.message);
      try { ws.close(); } catch { /* ignore */ }
      // Permanent auth failures should not reconnect-spam the middleware.
      if (truenasState.authFailed) truenasClearTimers();
    }
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Notifications have method and no id — ignore for request/response.
    if (msg == null || msg.id == null) return;
    const cb = truenasState.callbacks.get(msg.id);
    if (!cb) return;
    truenasState.callbacks.delete(msg.id);
    cb(msg.result, msg.error);
  });

  ws.on('close', () => {
    truenasState.ready = false;
    truenasState.connecting = false;
    truenasState.ws = null;
    truenasClearTimers();
    truenasFailPending({ message: 'TrueNAS WebSocket closed' });
    if (!truenasState.authFailed) truenasScheduleReconnect();
  });

  ws.on('error', (err) => {
    truenasState.lastError = err?.message || 'TrueNAS WebSocket error';
    truenasState.ready = false;
    // 'close' follows and schedules reconnect.
  });
}

async function fetchTrueNAS() {
  if (!truenasConfigured()) return { error: 'TrueNAS not configured' };

  // Serve brief cache if reconnecting after a good snapshot.
  const cacheTtl = 15000;
  if (!truenasState.ready && truenasState.cache && (Date.now() - truenasState.cacheAt) < cacheTtl) {
    return { ...truenasState.cache, stale: true };
  }

  if (!truenasState.ready) {
    truenasConnect();
    return {
      error: truenasState.lastError || 'TrueNAS WebSocket not connected',
      pools: truenasState.cache?.pools || [],
      alerts: truenasState.cache?.alerts || [],
      systemInfo: truenasState.cache?.systemInfo || null,
      appsDown: truenasState.cache?.appsDown || [],
      stale: Boolean(truenasState.cache),
    };
  }

  const [pools, systemInfo, rawAlerts] = await Promise.all([
    truenasRpc('pool.query'),
    truenasRpc('system.info'),
    truenasRpc('alert.list'),
  ]);

  // alert.list includes dismissed one-shots; only surface active alerts.
  const alerts = (Array.isArray(rawAlerts) ? rawAlerts : []).filter((a) => !a?.dismissed);

  let appsDown = [];
  try {
    const apps = await truenasRpc('app.query');
    if (Array.isArray(apps)) {
      appsDown = apps
        .filter((a) => a.state && a.state !== 'RUNNING')
        .map((a) => ({
          name: a.name || a.id || 'unknown',
          state: a.state || 'STOPPED',
        }));
    }
  } catch {
    // CORE or apps API unavailable
  }

  const payload = { pools, systemInfo, alerts, appsDown };
  truenasState.cache = payload;
  truenasState.cacheAt = Date.now();
  return payload;
}

truenasConnect();

app.get('/api/truenas', async (_req, res) => {
  try { res.json(await fetchTrueNAS()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function fetchServices() {
  const raw = process.env.MONITORED_SERVICES || '';
  if (!raw) return [];
  const services = raw.split(',')
    .map((s) => {
      const [name, ...urlParts] = s.split('|');
      return { name: name.trim(), url: urlParts.join('|').trim() };
    })
    .filter(({ name, url }) => name && url);
  return Promise.all(services.map(async ({ name, url }) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return { name, url, status: 'up', code: resp.status };
    } catch {
      return { name, url, status: 'down', code: null };
    }
  }));
}

app.get('/api/services', async (_req, res) => {
  try { res.json(await fetchServices()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function fetchQbit() {
  const host = (process.env.QBIT_HOST || '').replace(/\/$/, '');
  const key = process.env.QBIT_API_KEY;
  if (!host || !key) return { error: 'qBittorrent not configured' };

  const headers = {
    Authorization: `Bearer ${key}`,
    Referer: host,
  };

  // Active transfers: downloading + uploading (seeding with peers).
  const [transferResp, downloadingResp, uploadingResp] = await Promise.all([
    fetch(`${host}/api/v2/transfer/info`, { headers }),
    fetch(`${host}/api/v2/torrents/info?filter=downloading`, { headers }),
    fetch(`${host}/api/v2/torrents/info?filter=uploading`, { headers }),
  ]);

  if (!transferResp.ok) {
    return { error: `qBittorrent transfer HTTP ${transferResp.status}` };
  }
  if (!downloadingResp.ok) {
    return { error: `qBittorrent downloading HTTP ${downloadingResp.status}` };
  }
  if (!uploadingResp.ok) {
    return { error: `qBittorrent uploading HTTP ${uploadingResp.status}` };
  }

  const [transfer, downloadingRaw, uploadingRaw] = await Promise.all([
    transferResp.json(),
    downloadingResp.json(),
    uploadingResp.json(),
  ]);

  const downloading = Array.isArray(downloadingRaw) ? downloadingRaw : [];
  const uploading = Array.isArray(uploadingRaw) ? uploadingRaw : [];

  const byHash = new Map();
  for (const t of downloading) {
    if (!t?.hash) continue;
    byHash.set(t.hash, {
      ...t,
      _downloading: true,
      // Only treat as active upload when bytes are actually going out.
      _uploading: (t.upspeed || 0) > 0,
    });
  }
  for (const t of uploading) {
    if (!t?.hash) continue;
    // Skip idle seeders — filter=uploading includes stalled/completed seeds.
    if ((t.upspeed || 0) <= 0 && !byHash.has(t.hash)) continue;
    const prev = byHash.get(t.hash);
    if (prev) {
      byHash.set(t.hash, {
        ...prev,
        ...t,
        _downloading: true,
        _uploading: (t.upspeed || 0) > 0 || prev._uploading,
      });
    } else {
      byHash.set(t.hash, { ...t, _downloading: false, _uploading: (t.upspeed || 0) > 0 });
    }
  }

  const mapTorrent = (t, activity) => ({
    name: t.name,
    progress: Math.round((t.progress || 0) * 1000) / 10,
    dlspeed: t.dlspeed || 0,
    upspeed: t.upspeed || 0,
    state: t.state,
    activity,
  });

  // Separate columns: downloads sorted by fastest DL, uploads by fastest UL.
  const downloads = [...byHash.values()]
    .filter((t) => t._downloading || (t.dlspeed || 0) > 0)
    .sort((a, b) => (b.dlspeed || 0) - (a.dlspeed || 0))
    .slice(0, 10)
    .map((t) => mapTorrent(t, (t.upspeed || 0) > 0 ? 'both' : 'download'));

  const uploads = [...byHash.values()]
    .filter((t) => (t.upspeed || 0) > 0)
    .sort((a, b) => (b.upspeed || 0) - (a.upspeed || 0))
    .slice(0, 10)
    .map((t) => mapTorrent(t, (t.dlspeed || 0) > 0 || t._downloading ? 'both' : 'upload'));

  return {
    dlSpeed: transfer.dl_info_speed || 0,
    upSpeed: transfer.up_info_speed || 0,
    downloadingCount: downloads.length,
    uploadingCount: uploads.length,
    torrentCount: downloads.length + uploads.length,
    downloads,
    uploads,
    // Back-compat for older UI
    torrents: [...downloads, ...uploads],
  };
}

app.get('/api/qbit', async (_req, res) => {
  try { res.json(await fetchQbit()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function fetchFinance() {
  const results = {};
  const mortgageResp = await fetch('https://www.freddiemac.com/pmms/docs/PMMS_history.csv');
  const mortgageText = await mortgageResp.text();
  const mortgageLines = mortgageText.trim().split('\n');
  const lastLine = mortgageLines[mortgageLines.length - 1];
  const cols = lastLine.split(',').map((c) => c.replace(/"/g, '').trim());
  results.mortgage30 = cols[1] ? { value: cols[1], date: cols[0] } : null;
  results.mortgage15 = cols[3] ? { value: cols[3], date: cols[0] } : null;
  const treasuryResp = await fetch('https://home.treasury.gov/sites/default/files/interest-rates/yield.xml');
  const treasuryText = await treasuryResp.text();
  const blocks = treasuryText.split('<G_NEW_DATE>');
  const lastBlock = blocks[blocks.length - 1];
  const extract = (tag) => {
    const m = lastBlock.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m ? m[1].trim() : null;
  };
  const tDate = extract('NEW_DATE') || '';
  results.treasury10 = { value: extract('BC_10YEAR'), date: tDate };
  results.treasury2 = { value: extract('BC_2YEAR'), date: tDate };
  return results;
}

app.get('/api/finance', async (_req, res) => {
  try { res.json(await fetchFinance()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function fetchStocks(symbolsParam) {
  const symbols = (symbolsParam || 'SPY,DIA,QQQ').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const names = { SPY: 'S&P 500', DIA: 'DOW', QQQ: 'NASDAQ' };
  return Promise.all(symbols.map(async (symbol) => {
    const resp = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const data = await resp.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return { symbol, name: names[symbol] || symbol, price: 0, change: 0, changePercent: 0 };
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose;
    const change = price - prev;
    const changePercent = prev ? (change / prev) * 100 : 0;
    return {
      symbol, name: names[symbol] || symbol, price, change, changePercent,
      high: meta.regularMarketDayHigh || price, low: meta.regularMarketDayLow || price,
    };
  }));
}

app.get('/api/stocks', async (req, res) => {
  try { res.json(await fetchStocks(req.query.symbols)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function fetchDeliveries() {
  const key = process.env.AFTERSHIP_API_KEY;
  const trackingRaw = process.env.TRACKING_NUMBERS || '';
  if (!key) return { error: 'AfterShip not configured' };
  if (!trackingRaw) return [];
  const trackings = trackingRaw.split(',').map((t) => {
    const [carrier, number] = t.split(':');
    return { carrier: carrier.trim().toLowerCase(), number: number.trim() };
  });
  const slugMap = { ups: 'ups', fedex: 'fedex', amazon: 'amazon' };
  return Promise.all(trackings.map(async ({ carrier, number }) => {
    try {
      const slug = slugMap[carrier] || carrier;
      const resp = await fetch(`https://api.aftership.com/v4/trackings/${slug}/${number}`, {
        headers: { 'aftership-api-key': key },
      });
      const data = await resp.json();
      const t = data.data?.tracking;
      return {
        carrier: carrier.toUpperCase(), number,
        status: t?.tag || 'Unknown', substatus: t?.subtag_message || '',
        eta: t?.expected_delivery || null,
        lastUpdate: t?.checkpoints?.slice(-1)[0]?.message || '',
      };
    } catch {
      return { carrier: carrier.toUpperCase(), number, status: 'Error', substatus: '', eta: null, lastUpdate: '' };
    }
  }));
}

app.get('/api/deliveries', async (_req, res) => {
  try { res.json(await fetchDeliveries()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function fetchNews() {
  const category = process.env.KAGI_NEWS_CATEGORY || 'world';
  const limit = parseInt(process.env.KAGI_NEWS_LIMIT) || 5;
  const catResp = await fetch('https://news.kagi.com/api/batches/latest/categories?lang=en');
  const catData = await catResp.json();
  const cat = catData.categories?.find((c) => c.categoryId === category);
  if (!cat) return { error: `Category "${category}" not found` };
  const storiesResp = await fetch(
    `https://news.kagi.com/api/batches/latest/categories/${cat.id}/stories?limit=${limit}&lang=en`
  );
  const storiesData = await storiesResp.json();
  return (storiesData.stories || []).map((s) => ({
    title: s.title, emoji: s.emoji || '', summary: s.short_summary || '',
    sources: s.unique_domains || 0, category: cat.categoryName,
  }));
}

async function fetchChaos() {
  const resp = await fetch('https://news.kagi.com/api/batches/latest/chaos?lang=en');
  const data = await resp.json();
  return { index: data.chaosIndex, description: data.chaosDescription, lastUpdated: data.chaosLastUpdated };
}

app.get('/api/news', async (_req, res) => {
  try { res.json(await fetchNews()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/chaos', async (_req, res) => {
  try { res.json(await fetchChaos()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function fetchCalendar() {
  let url = process.env.NEXTCLOUD_URL;
  const user = process.env.NEXTCLOUD_USERNAME;
  const pass = process.env.NEXTCLOUD_PASSWORD;
  const cal = process.env.NEXTCLOUD_CALENDAR_NAME || 'personal';
  if (!url || !user || !pass) return { error: 'Nextcloud not configured' };
  // Allow full login URLs or host-only values; normalize to origin for CalDAV.
  try {
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    const parsed = new URL(url);
    // Strip accidental /login paths from UI URLs.
    url = parsed.origin;
  } catch {
    return { error: 'Nextcloud URL invalid' };
  }
  const baseUrl = url;
  const calUrl = `${baseUrl}/remote.php/dav/calendars/${user}/${cal}/`;
  const now = new Date();
  const future = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${fmt(now)}" end="${fmt(future)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
  const resp = await fetch(calUrl, {
    method: 'REPORT',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1',
    },
    body,
  });
  if (resp.status === 401) return { error: 'Nextcloud auth failed — use an app password' };
  if (!resp.ok) return { error: `Nextcloud returned HTTP ${resp.status}` };
  const text = await resp.text();
  const events = [];
  const regex = /<(?:cal|c|d):calendar-data[^>]*>([\s\S]*?)<\/(?:cal|c|d):calendar-data>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const decoded = match[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
    try {
      const parsed = ical.parseICS(decoded);
      for (const key of Object.keys(parsed)) {
        const ev = parsed[key];
        if (ev.type === 'VEVENT') {
          events.push({ summary: ev.summary || 'Untitled', start: ev.start, end: ev.end, location: ev.location || '' });
        }
      }
    } catch { /* skip */ }
  }
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return events.slice(0, 5);
}

app.get('/api/calendar', async (_req, res) => {
  try { res.json(await fetchCalendar()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function fetchNetwork() {
  const raw = process.env.PING_HOSTS || '';
  if (!raw) return [];
  const hosts = raw.split(',').map((h) => {
    const [name, host] = h.split('|');
    return { name: name.trim(), host: host.trim() };
  });
  return Promise.all(hosts.map(({ name, host }) => new Promise((resolve) => {
    exec(`ping -c 1 -W 2 ${host}`, (err, stdout) => {
      if (err) resolve({ name, host, status: 'down', latency: null });
      else {
        const m = stdout.match(/time[=<](\d+\.?\d*)/);
        resolve({ name, host, status: 'up', latency: m ? parseFloat(m[1]) : null });
      }
    });
  })));
}

app.get('/api/network', async (_req, res) => {
  try { res.json(await fetchNetwork()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

function getByPath(obj, pathStr) {
  if (!pathStr) return obj;
  return pathStr.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    const m = key.match(/^(\w+)\[(\d+)\]$/);
    if (m) return acc[m[1]]?.[Number(m[2])];
    return acc[key];
  }, obj);
}

async function fetchCustomSource(source) {
  const method = (source.method || 'GET').toUpperCase();
  const headers = { ...(source.headers || {}) };
  const init = { method, headers };
  if (source.body && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof source.body === 'string' ? source.body : JSON.stringify(source.body);
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), source.timeoutMs || 10000);
  try {
    const resp = await fetch(source.url, { ...init, signal: controller.signal });
    const ct = resp.headers.get('content-type') || '';
    let data = ct.includes('application/json') ? await resp.json() : await resp.text();
    if (source.jsonPath && data && typeof data === 'object') data = getByPath(data, source.jsonPath);
    if (!resp.ok) return { error: `HTTP ${resp.status}`, data };
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

const BUILTIN_FETCHERS = {
  weather: fetchWeather,
  truenas: fetchTrueNAS,
  services: fetchServices,
  qbit: fetchQbit,
  finance: fetchFinance,
  stocks: (q) => fetchStocks(q?.symbols),
  deliveries: fetchDeliveries,
  news: fetchNews,
  chaos: fetchChaos,
  calendar: fetchCalendar,
  network: fetchNetwork,
};

app.get('/api/data/:source', async (req, res) => {
  try {
    const name = req.params.source;
    if (BUILTIN_FETCHERS[name]) {
      return res.json(await BUILTIN_FETCHERS[name](req.query));
    }
    const custom = getSource(name);
    if (custom) return res.json(await fetchCustomSource(custom));
    res.status(404).json({ error: `Unknown source: ${name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on http://0.0.0.0:${PORT}`);
  console.log(`Editor at http://0.0.0.0:${PORT}/editor`);
});
