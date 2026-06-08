// Dashboard Controller
// Non-interactive kiosk display — all widgets auto-refresh on independent intervals

let config = {};

const $ = (id) => document.getElementById(id);

// ── Utilities ──────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

function formatUptime(seconds) {
  if (!seconds) return 'N/A';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Clock ──────────────────────────────────────────────────────────────────

function updateClock() {
  const now = new Date();
  const tz = 'America/Denver';
  $('clock-time').textContent = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    timeZone: tz,
  });
  $('clock-date').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: tz,
  }) + ' MST';
}

// ── Weather ────────────────────────────────────────────────────────────────

// WMO weather codes → icons (day/night variants)
function weatherIcon(code, isDay) {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return isDay ? '⛅' : '☁️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '❄️';
  return '⛈️';
}

async function updateWeather() {
  const data = await fetchJSON('/api/weather');
  const el = $('weather-content');
  if (data.error) {
    el.innerHTML = '<span class="text-muted">Weather unavailable</span>';
    return;
  }
  el.innerHTML = `
    <div class="weather-main">
      <span class="weather-icon">${weatherIcon(data.weatherCode, data.isDay)}</span>
      <span class="weather-temp">${data.temp}°F</span>
    </div>
    <div class="weather-details">
      <span>${data.description}</span>
      <span>H: ${data.high}° L: ${data.low}°</span>
      <span>Humidity: ${data.humidity}%</span>
    </div>`;
}

// ── TrueNAS ────────────────────────────────────────────────────────────────

async function updateTrueNAS() {
  const data = await fetchJSON('/api/truenas');
  const el = $('truenas-content');
  if (data.error) {
    el.innerHTML = `<h4 class="infra-section-title">TrueNAS</h4><span class="text-muted">${data.error}</span>`;
    return;
  }

  let html = '<h4 class="infra-section-title">TrueNAS</h4>';

  // Pools
  if (data.pools && data.pools.length) {
    html += '<div class="truenas-section"><h4>Storage Pools</h4>';
    for (const pool of data.pools) {
      const status = pool.status || (pool.healthy ? 'ONLINE' : 'DEGRADED');
      const cls = status === 'ONLINE' ? 'status-up' : 'status-down';
      html += `<div class="truenas-pool">
        <span class="status-dot ${cls}"></span>
        <span class="pool-name">${pool.name}</span>
        <span class="${cls}" style="margin-left:auto">${status}</span>
      </div>`;
    }
    html += '</div>';
  }

  // System Info
  if (data.systemInfo) {
    html += `<div class="truenas-section"><h4>System</h4>
      <div class="sys-info">
        <span>Version: ${data.systemInfo.version || 'N/A'}</span>
        <span>Uptime: ${formatUptime(data.systemInfo.uptime_seconds)}</span>
      </div></div>`;
  }

  // Alerts
  if (data.alerts && data.alerts.length) {
    html += '<div class="truenas-section"><h4>Alerts</h4>';
    for (const alert of data.alerts.slice(0, 3)) {
      const lvl = (alert.level || 'INFO').toUpperCase();
      const cls = lvl === 'CRITICAL' ? 'status-down' :
                  lvl === 'WARNING'  ? 'status-warn' : 'status-info';
      html += `<div class="alert-item ${cls}">${alert.formatted || alert.message || 'Alert'}</div>`;
    }
    html += '</div>';
  } else {
    html += '<div class="truenas-section"><h4>Alerts</h4><span class="text-muted">No active alerts</span></div>';
  }

  el.innerHTML = html;
}

// ── Services ───────────────────────────────────────────────────────────────

async function updateServices() {
  const data = await fetchJSON('/api/services');
  const el = $('services-content');
  if (data.error) {
    el.innerHTML = `<h4 class="infra-section-title">Monitors</h4><span class="text-muted">${data.error}</span>`;
    return;
  }
  if (!data.length) {
    el.innerHTML = '<h4 class="infra-section-title">Monitors</h4><span class="text-muted">No services configured</span>';
    return;
  }
  el.innerHTML = '<h4 class="infra-section-title">Monitors</h4><div class="services-grid">' + data.map(s => `
    <div class="service-item">
      <span class="service-name">${s.name}</span>
      <div class="service-status">
        <span class="status-dot ${s.status === 'up' ? 'status-up' : 'status-down'}"></span>
        <span class="${s.status === 'up' ? 'status-up' : 'status-down'}">${s.status.toUpperCase()}</span>
      </div>
    </div>`).join('') + '</div>';
}

// ── Finance ────────────────────────────────────────────────────────────────

async function updateFinance() {
  const data = await fetchJSON('/api/finance');
  const el = $('finance-content');
  if (data.error) {
    el.innerHTML = `<span class="text-muted">${data.error}</span>`;
    return;
  }

  const rates = [
    { label: '30-Yr Mortgage', key: 'mortgage30', suffix: '%' },
    { label: '15-Yr Mortgage', key: 'mortgage15', suffix: '%' },
    { label: '10-Yr Treasury', key: 'treasury10', suffix: '%' },
    { label: '2-Yr Treasury',  key: 'treasury2',  suffix: '%' },
  ];

  el.innerHTML = '<div class="rate-grid">' + rates.map(r => {
    const d = data[r.key];
    if (!d || !d.value) return `<div class="rate-card">
      <div class="rate-label">${r.label}</div>
      <div class="rate-value text-muted">N/A</div></div>`;
    return `<div class="rate-card">
      <div class="rate-label">${r.label}</div>
      <div class="rate-value">${d.value}${r.suffix}</div>
      <div class="rate-date">as of ${d.date}</div></div>`;
  }).join('') + '</div>';
}

// ── Stocks ─────────────────────────────────────────────────────────────────

async function updateStocks() {
  if (config.enabled?.stocks === false) {
    $('stocks-widget').style.display = 'none';
    return;
  }

  const data = await fetchJSON('/api/stocks');
  const el = $('stocks-content');
  if (data.error) {
    el.innerHTML = `<span class="text-muted">${data.error}</span>`;
    return;
  }

  el.innerHTML = data.map(s => {
    const cls = (s.change || 0) >= 0 ? 'positive' : 'negative';
    const arrow = (s.change || 0) >= 0 ? '▲' : '▼';
    return `<div class="stock-item">
      <div><div class="stock-name">${s.name}</div>
           <div class="stock-symbol">${s.symbol}</div></div>
      <div style="text-align:right">
        <div class="stock-price">$${(s.price || 0).toFixed(2)}</div>
        <div class="stock-change ${cls}">${arrow} ${Math.abs(s.change || 0).toFixed(2)} (${Math.abs(s.changePercent || 0).toFixed(2)}%)</div>
      </div></div>`;
  }).join('');
}

// ── Deliveries ─────────────────────────────────────────────────────────────

async function updateDeliveries() {
  if (config.enabled?.deliveries === false) {
    const w = $('deliveries-widget');
    if (w) w.style.display = 'none';
    return;
  }

  const data = await fetchJSON('/api/deliveries');
  const el = $('deliveries-content');
  if (data.error) {
    el.innerHTML = `<span class="text-muted">${data.error}</span>`;
    return;
  }
  if (!data.length) {
    el.innerHTML = '<span class="text-muted">No active deliveries</span>';
    return;
  }

  el.innerHTML = data.map(d => {
    const sc = d.status === 'Delivered' ? 'status-up' :
               d.status === 'Error'     ? 'status-down' : 'status-warn';
    return `<div class="delivery-item">
      <div class="delivery-header">
        <span class="delivery-carrier">${d.carrier}</span>
        <span class="delivery-status ${sc}">${d.status}</span>
      </div>
      <div class="delivery-tracking">${d.number}</div>
      ${d.eta ? `<div class="delivery-detail">ETA: ${d.eta}</div>` : ''}
      ${d.lastUpdate ? `<div class="delivery-detail">${d.lastUpdate}</div>` : ''}
    </div>`;
  }).join('');
}

// ── News ───────────────────────────────────────────────────────────────────

async function updateNews() {
  if (config.enabled?.news === false) {
    const w = $('news-widget');
    if (w) w.style.display = 'none';
    return;
  }

  const data = await fetchJSON('/api/news');
  const el = $('news-content');
  if (data.error) {
    el.innerHTML = `<span class="text-muted">${data.error}</span>`;
    return;
  }
  if (!data.length) {
    el.innerHTML = '<span class="text-muted">No headlines</span>';
    return;
  }

  el.innerHTML = data.map(a => `
    <div class="news-item">
      <div class="news-title">${a.emoji ? a.emoji + ' ' : ''}${a.title}</div>
      <div class="news-source">${a.sources} sources</div>
    </div>`).join('');
}

// ── Chaos Index ─────────────────────────────────────────────────────────────────────

async function updateChaos() {
  const data = await fetchJSON('/api/chaos');
  const el = $('chaos-content');
  if (data.error || data.index == null) {
    el.innerHTML = '';
    return;
  }
  const idx = data.index;
  const color = idx >= 70 ? '#ef4444' : idx >= 40 ? '#f59e0b' : '#10b981';
  el.innerHTML = `
    <div class="chaos-label">CHAOS</div>
    <div class="chaos-value" style="color:${color}">${idx}</div>`;
  el.title = data.description || '';
}

// ── Calendar ───────────────────────────────────────────────────────────────

async function updateCalendar() {
  if (config.enabled?.calendar === false) {
    const w = $('calendar-widget');
    if (w) w.style.display = 'none';
    return;
  }

  const data = await fetchJSON('/api/calendar');
  const el = $('calendar-content');
  if (data.error) {
    el.innerHTML = `<span class="text-muted">${data.error}</span>`;
    return;
  }
  if (!data.length) {
    el.innerHTML = '<span class="text-muted">No upcoming events</span>';
    return;
  }

  el.innerHTML = data.map(ev => {
    const start = new Date(ev.start);
    const month = start.toLocaleDateString('en-US', { month: 'short' });
    const day = start.getDate();
    const time = start.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    return `<div class="cal-event">
      <div class="cal-date">
        <div class="cal-month">${month}</div>
        <div class="cal-day">${day}</div>
      </div>
      <div class="cal-details">
        <div class="cal-summary">${ev.summary}</div>
        <div class="cal-time">${time}</div>
        ${ev.location ? `<div class="cal-location">📍 ${ev.location}</div>` : ''}
      </div></div>`;
  }).join('');
}

// ── Network ────────────────────────────────────────────────────────────────

async function updateNetwork() {
  if (config.enabled?.network === false) {
    $('network-widget').style.display = 'none';
    return;
  }

  const data = await fetchJSON('/api/network');
  const el = $('network-content');
  if (data.error || !data.length) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = data.map(h => `
    <div class="net-host">
      <div class="net-dot ${h.status === 'up' ? 'bg-up' : 'bg-down'}"></div>
      <span>${h.name}${h.latency !== null ? ` ${h.latency}ms` : ''}</span>
    </div>`).join('') +
    (config.version ? `<div class="net-version">v${config.version}</div>` : '');
}

// ── Initialization ─────────────────────────────────────────────────────────

async function init() {
  config = await fetchJSON('/api/config');
  if (config.error) config = { refresh: {}, enabled: {} };

  // Clock — always runs client-side
  updateClock();
  setInterval(updateClock, 1000);

  // Initial fetch for all widgets
  updateWeather();
  updateTrueNAS();
  updateServices();
  updateFinance();
  updateStocks();
  updateDeliveries();
  updateNews();
  updateCalendar();
  updateNetwork();
  updateChaos();

  // Refresh intervals
  const r = config.refresh || {};
  setInterval(updateWeather,    r.weather    || 600000);
  setInterval(updateTrueNAS,    r.truenas    || 30000);
  setInterval(updateServices,   r.services   || 60000);
  setInterval(updateFinance,    r.finance    || 300000);
  setInterval(updateStocks,     r.finance    || 300000);
  setInterval(updateDeliveries, r.deliveries || 900000);
  setInterval(updateNews,       r.news       || 1800000);
  setInterval(updateCalendar,   r.calendar   || 300000);
  setInterval(updateNetwork,    r.network    || 60000);
  setInterval(updateChaos,      r.news       || 1800000);
}

document.addEventListener('DOMContentLoaded', init);
