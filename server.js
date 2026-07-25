const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const ical = require('node-ical');
require('dotenv').config();

const pkg = require('./package.json');

const app = express();
const PORT = process.env.PORT || 1337;

// Serve static frontend (no-cache headers to ensure updates are picked up)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  },
}));

// ---------------------------------------------------------------------------
// Config — sends non-sensitive settings to the frontend
// ---------------------------------------------------------------------------
app.get('/api/config', (_req, res) => {
  res.json({
    version: pkg.version,
    refresh: {
      weather: (parseInt(process.env.REFRESH_WEATHER) || 600) * 1000,
      truenas: (parseInt(process.env.REFRESH_TRUENAS) || 30) * 1000,
      finance: (parseInt(process.env.REFRESH_FINANCE) || 300) * 1000,
      crypto: (parseInt(process.env.REFRESH_CRYPTO) || 300) * 1000,
      news: (parseInt(process.env.REFRESH_NEWS) || 1800) * 1000,
      calendar: (parseInt(process.env.REFRESH_CALENDAR) || 300) * 1000,
      network: (parseInt(process.env.REFRESH_NETWORK) || 60) * 1000,
      services: (parseInt(process.env.REFRESH_SERVICES) || 60) * 1000,
    },
    enabled: {
      stocks: process.env.ENABLE_STOCKS !== 'false',
      news: process.env.ENABLE_NEWS !== 'false',
      calendar: process.env.ENABLE_CALENDAR !== 'false',
      network: process.env.ENABLE_NETWORK !== 'false',
    },
  });
});

// ---------------------------------------------------------------------------
// Weather — Open-Meteo (no API key, privacy-first)
// ---------------------------------------------------------------------------
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

app.get('/api/weather', async (_req, res) => {
  try {
    const lat = process.env.WEATHER_LAT;
    const lon = process.env.WEATHER_LON;
    if (!lat || !lon) return res.json({ error: 'Weather not configured' });

    const resp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
    );
    const data = await resp.json();
    if (data.error) return res.json({ error: data.reason || 'API error' });

    const cur = data.current;
    const daily = data.daily;

    res.json({
      temp: Math.round(cur.temperature_2m),
      feels_like: Math.round(cur.apparent_temperature),
      high: Math.round(daily.temperature_2m_max[0]),
      low: Math.round(daily.temperature_2m_min[0]),
      humidity: cur.relative_humidity_2m,
      description: WMO_DESCRIPTIONS[cur.weather_code] || 'Unknown',
      weatherCode: cur.weather_code,
      isDay: cur.is_day,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// TrueNAS — API proxy
// ---------------------------------------------------------------------------
async function truenasFetch(endpoint) {
  const host = process.env.TRUENAS_HOST;
  const key = process.env.TRUENAS_API_KEY;
  const proto = process.env.TRUENAS_PROTOCOL || 'http';
  const resp = await fetch(`${proto}://${host}/api/v2.0/${endpoint}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return resp.json();
}

app.get('/api/truenas', async (_req, res) => {
  try {
    const host = process.env.TRUENAS_HOST;
    const key = process.env.TRUENAS_API_KEY;
    if (!host || !key) return res.json({ error: 'TrueNAS not configured' });

    const [pools, systemInfo, alerts] = await Promise.all([
      truenasFetch('pool'),
      truenasFetch('system/info'),
      truenasFetch('alert/list'),
    ]);

    // Apps (TrueNAS SCALE only — gracefully ignore if unavailable)
    let appsDown = [];
    try {
      const apps = await truenasFetch('app');
      if (Array.isArray(apps)) {
        appsDown = apps
          .filter((a) => a.state !== 'RUNNING')
          .map((a) => ({ name: a.name, state: a.state || 'STOPPED' }));
      }
    } catch {
      // TrueNAS CORE or endpoint unavailable — skip
    }

    res.json({ pools, systemInfo, alerts, appsDown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Services — HTTP health checks for user-defined URLs
// ---------------------------------------------------------------------------
app.get('/api/services', async (_req, res) => {
  const raw = process.env.MONITORED_SERVICES || '';
  if (!raw) return res.json([]);

  const services = raw.split(',')
    .map((s) => {
      const [name, ...urlParts] = s.split('|');
      return { name: name.trim(), url: urlParts.join('|').trim() };
    })
    .filter(({ name, url }) => name && url);

  const results = await Promise.all(
    services.map(async ({ name, url }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        return { name, url, status: 'up', code: resp.status };
      } catch {
        return { name, url, status: 'down', code: null };
      }
    })
  );

  res.json(results);
});

// ---------------------------------------------------------------------------
// Finance — Public data, no API keys
//   Mortgage rates: Freddie Mac PMMS (weekly CSV)
//   Treasury yields: Treasury.gov (daily XML)
// ---------------------------------------------------------------------------
app.get('/api/finance', async (_req, res) => {
  try {
    const results = {};

    // Freddie Mac Primary Mortgage Market Survey
    const mortgageResp = await fetch(
      'https://www.freddiemac.com/pmms/docs/PMMS_history.csv'
    );
    const mortgageText = await mortgageResp.text();
    const mortgageLines = mortgageText.trim().split('\n');
    const lastLine = mortgageLines[mortgageLines.length - 1];
    const cols = lastLine.split(',').map((c) => c.replace(/"/g, '').trim());
    results.mortgage30 = cols[1] ? { value: cols[1], date: cols[0] } : null;
    results.mortgage15 = cols[3] ? { value: cols[3], date: cols[0] } : null;

    // Treasury.gov yield curve XML
    const treasuryResp = await fetch(
      'https://home.treasury.gov/sites/default/files/interest-rates/yield.xml'
    );
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

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Stocks — Yahoo Finance (no API key needed)
// ---------------------------------------------------------------------------
app.get('/api/stocks', async (_req, res) => {
  try {
    const symbols = ['SPY', 'DIA', 'QQQ'];
    const names = { SPY: 'S&P 500', DIA: 'DOW', QQQ: 'NASDAQ' };

    const results = await Promise.all(
      symbols.map(async (symbol) => {
        const resp = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const data = await resp.json();
        const meta = data.chart?.result?.[0]?.meta;
        if (!meta) return { symbol, name: names[symbol], price: 0, change: 0, changePercent: 0 };

        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose;
        const change = price - prev;
        const changePercent = prev ? (change / prev) * 100 : 0;

        return {
          symbol,
          name: names[symbol],
          price,
          change,
          changePercent,
          high: meta.regularMarketDayHigh || price,
          low: meta.regularMarketDayLow || price,
        };
      })
    );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Deliveries — AfterShip proxy
// ---------------------------------------------------------------------------
app.get('/api/deliveries', async (_req, res) => {
  try {
    const key = process.env.AFTERSHIP_API_KEY;
    const trackingRaw = process.env.TRACKING_NUMBERS || '';
    if (!key) return res.json({ error: 'AfterShip not configured' });
    if (!trackingRaw) return res.json([]);

    const trackings = trackingRaw.split(',').map((t) => {
      const [carrier, number] = t.split(':');
      return { carrier: carrier.trim().toLowerCase(), number: number.trim() };
    });

    const slugMap = { ups: 'ups', fedex: 'fedex', amazon: 'amazon' };

    const results = await Promise.all(
      trackings.map(async ({ carrier, number }) => {
        try {
          const slug = slugMap[carrier] || carrier;
          const resp = await fetch(
            `https://api.aftership.com/v4/trackings/${slug}/${number}`,
            { headers: { 'aftership-api-key': key } }
          );
          const data = await resp.json();
          const t = data.data?.tracking;
          return {
            carrier: carrier.toUpperCase(),
            number,
            status: t?.tag || 'Unknown',
            substatus: t?.subtag_message || '',
            eta: t?.expected_delivery || null,
            lastUpdate: t?.checkpoints?.slice(-1)[0]?.message || '',
          };
        } catch {
          return {
            carrier: carrier.toUpperCase(),
            number,
            status: 'Error',
            substatus: '',
            eta: null,
            lastUpdate: '',
          };
        }
      })
    );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Crypto — CoinGecko (no API key needed)
// ---------------------------------------------------------------------------
app.get('/api/crypto', async (_req, res) => {
  try {
    const coins = (process.env.CRYPTO_COINS || 'bitcoin,ethereum,solana').split(',').map((c) => c.trim());
    const symbols = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', cardano: 'ADA', dogecoin: 'DOGE', ripple: 'XRP' };
    const names   = { bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana', cardano: 'Cardano', dogecoin: 'Dogecoin', ripple: 'XRP' };

    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await resp.json();

    const result = coins.map((id) => ({
      id,
      name: names[id] || id,
      symbol: symbols[id] || id.toUpperCase(),
      price: data[id]?.usd ?? null,
      change: data[id]?.usd_24h_change ?? null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// News — Kagi News API (no API key needed)
// ---------------------------------------------------------------------------
app.get('/api/news', async (_req, res) => {
  try {
    const category = process.env.KAGI_NEWS_CATEGORY || 'world';
    const limit = parseInt(process.env.KAGI_NEWS_LIMIT) || 5;

    // Get categories to find the UUID for the desired category slug
    const catResp = await fetch(
      'https://news.kagi.com/api/batches/latest/categories?lang=en'
    );
    const catData = await catResp.json();
    const cat = catData.categories?.find(
      (c) => c.categoryId === category
    );
    if (!cat) return res.json({ error: `Category "${category}" not found` });

    // Get stories for that category
    const storiesResp = await fetch(
      `https://news.kagi.com/api/batches/latest/categories/${cat.id}/stories?limit=${limit}&lang=en`
    );
    const storiesData = await storiesResp.json();

    const articles = (storiesData.stories || []).map((s) => ({
      title: s.title,
      emoji: s.emoji || '',
      summary: s.short_summary || '',
      sources: s.unique_domains || 0,
      category: cat.categoryName,
    }));

    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Chaos Index — Kagi News (no API key needed)
// ---------------------------------------------------------------------------
app.get('/api/chaos', async (_req, res) => {
  try {
    const resp = await fetch(
      'https://news.kagi.com/api/batches/latest/chaos?lang=en'
    );
    const data = await resp.json();
    res.json({
      index: data.chaosIndex,
      description: data.chaosDescription,
      lastUpdated: data.chaosLastUpdated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Calendar — Nextcloud CalDAV proxy
// ---------------------------------------------------------------------------
app.get('/api/calendar', async (_req, res) => {
  try {
    const url = process.env.NEXTCLOUD_URL;
    const user = process.env.NEXTCLOUD_USERNAME;
    const pass = process.env.NEXTCLOUD_PASSWORD;
    const cal = process.env.NEXTCLOUD_CALENDAR_NAME || 'personal';

    if (!url || !user || !pass)
      return res.json({ error: 'Nextcloud not configured' });

    // Strip any path (e.g. /login) to get the base URL
    const baseUrl = new URL(url).origin;
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
        Authorization:
          'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1',
      },
      body,
    });

    if (resp.status === 401) {
      return res.json({ error: 'Nextcloud auth failed — use an app password, not your account password' });
    }
    if (!resp.ok) {
      return res.json({ error: `Nextcloud returned HTTP ${resp.status}` });
    }

    const text = await resp.text();

    // Extract iCal blobs from the multistatus XML response
    const events = [];
    const regex =
      /<(?:cal|c|d):calendar-data[^>]*>([\s\S]*?)<\/(?:cal|c|d):calendar-data>/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const decoded = match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim();
      try {
        const parsed = ical.parseICS(decoded);
        for (const key of Object.keys(parsed)) {
          const ev = parsed[key];
          if (ev.type === 'VEVENT') {
            events.push({
              summary: ev.summary || 'Untitled',
              start: ev.start,
              end: ev.end,
              location: ev.location || '',
            });
          }
        }
      } catch {
        // skip unparseable
      }
    }

    events.sort((a, b) => new Date(a.start) - new Date(b.start));
    res.json(events.slice(0, 5));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Network — Ping check
// ---------------------------------------------------------------------------
app.get('/api/network', async (_req, res) => {
  const raw = process.env.PING_HOSTS || '';
  if (!raw) return res.json([]);

  const hosts = raw.split(',').map((h) => {
    const [name, host] = h.split('|');
    return { name: name.trim(), host: host.trim() };
  });

  const results = await Promise.all(
    hosts.map(
      ({ name, host }) =>
        new Promise((resolve) => {
          exec(`ping -c 1 -W 2 ${host}`, (err, stdout) => {
            if (err) {
              resolve({ name, host, status: 'down', latency: null });
            } else {
              const m = stdout.match(/time[=<](\d+\.?\d*)/);
              resolve({
                name,
                host,
                status: 'up',
                latency: m ? parseFloat(m[1]) : null,
              });
            }
          });
        })
    )
  );

  res.json(results);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on http://0.0.0.0:${PORT}`);
});
