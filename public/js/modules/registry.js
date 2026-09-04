// Module registry — each module: { id, mount(el, ctx), update?(el, data, ctx), unmount?(el) }
window.DashboardModules = (() => {
  const registry = {};

  function register(mod) {
    registry[mod.id] = mod;
  }

  function get(id) {
    return registry[id] || null;
  }

  function all() {
    return Object.values(registry);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getByPath(obj, pathStr) {
    if (!pathStr) return obj;
    return pathStr.split('.').reduce((acc, key) => {
      if (acc == null) return undefined;
      const m = key.match(/^(\w+)\[(\d+)\]$/);
      if (m) return acc[m[1]]?.[Number(m[2])];
      return acc[key];
    }, obj);
  }

  function formatUptime(seconds) {
    if (!seconds) return 'N/A';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  }

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

  // ── Clock ──────────────────────────────────────────────────────────────
  register({
    id: 'clock',
    dataSource: null,
    mount(el) {
      el.innerHTML = `
        <div class="widget-clock-inner">
          <div class="clock-time">--:--:-- --</div>
          <div class="clock-date">Loading...</div>
        </div>`;
    },
    update(el, _data, ctx) {
      const cfg = ctx.config || {};
      const tz = cfg.timeZone || 'America/Denver';
      const label = cfg.timeZoneLabel || '';
      const now = new Date();
      el.querySelector('.clock-time').textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: tz,
      });
      el.querySelector('.clock-date').textContent =
        now.toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
        }) + (label ? ` ${label}` : '');
    },
  });

  // ── Weather ────────────────────────────────────────────────────────────
  register({
    id: 'weather',
    dataSource: 'weather',
    mount(el) {
      el.innerHTML = `<div class="weather-content"><span class="text-muted">Loading...</span></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.weather-content') || el;
      if (!data || data.error) {
        root.innerHTML = '<span class="text-muted">Weather unavailable</span>';
        return;
      }
      root.innerHTML = `
        <div class="weather-main">
          <span class="weather-icon">${weatherIcon(data.weatherCode, data.isDay)}</span>
          <span class="weather-temp">${data.temp}°F</span>
        </div>
        <div class="weather-details">
          <span>${escapeHtml(data.description)}</span>
          <span>H: ${data.high}° L: ${data.low}°</span>
          <span>Humidity: ${data.humidity}%</span>
        </div>`;
    },
  });

  // ── Chaos ──────────────────────────────────────────────────────────────
  register({
    id: 'chaos',
    dataSource: 'chaos',
    mount(el) {
      el.innerHTML = `<div class="chaos-display"></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.chaos-display') || el;
      if (!data || data.error || data.index == null) {
        root.innerHTML = '';
        return;
      }
      const idx = data.index;
      const color = idx >= 70 ? '#ef4444' : idx >= 40 ? '#f59e0b' : '#10b981';
      root.innerHTML = `
        <div class="chaos-label">CHAOS</div>
        <div class="chaos-value" style="color:${color}">${idx}</div>`;
      root.title = data.description || '';
    },
  });

  // ── Network ────────────────────────────────────────────────────────────
  register({
    id: 'network',
    dataSource: 'network',
    mount(el) {
      el.innerHTML = `<div class="network-dots"></div>`;
    },
    update(el, data, ctx) {
      const root = el.querySelector('.network-dots') || el;
      if (!data || data.error || !data.length) {
        root.innerHTML = '';
        return;
      }
      root.innerHTML = data.map((h) => `
        <div class="net-host">
          <div class="net-dot ${h.status === 'up' ? 'bg-up' : 'bg-down'}"></div>
          <span>${escapeHtml(h.name)}${h.latency !== null ? ` ${h.latency}ms` : ''}</span>
        </div>`).join('') +
        (ctx.appConfig?.version ? `<div class="net-version">v${escapeHtml(ctx.appConfig.version)}</div>` : '');
    },
  });

  // ── Services ───────────────────────────────────────────────────────────
  register({
    id: 'services',
    dataSource: 'services',
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Loading...</span></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      if (!data?.length) {
        root.innerHTML = '<span class="text-muted">No services configured</span>';
        return;
      }
      root.innerHTML = '<div class="services-grid">' + data.map((s) => `
        <div class="service-item">
          <span class="service-name">${escapeHtml(s.name)}</span>
          <div class="service-status">
            <span class="status-dot ${s.status === 'up' ? 'status-up' : 'status-down'}"></span>
            <span class="${s.status === 'up' ? 'status-up' : 'status-down'}">${s.status.toUpperCase()}</span>
          </div>
        </div>`).join('') + '</div>';
    },
  });

  // ── TrueNAS ────────────────────────────────────────────────────────────
  register({
    id: 'truenas',
    dataSource: 'truenas',
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Loading...</span></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      let html = '';
      if (data.pools?.length) {
        html += '<div class="truenas-section"><h4>Storage Pools</h4>';
        for (const pool of data.pools) {
          const status = pool.status || (pool.healthy ? 'ONLINE' : 'DEGRADED');
          const cls = status === 'ONLINE' ? 'status-up' : 'status-down';
          html += `<div class="truenas-pool">
            <span class="status-dot ${cls}"></span>
            <span class="pool-name">${escapeHtml(pool.name)}</span>
            <span class="${cls}" style="margin-left:auto">${escapeHtml(status)}</span>
          </div>`;
        }
        html += '</div>';
      }
      if (data.systemInfo) {
        html += `<div class="truenas-section"><h4>System</h4>
          <div class="sys-info">
            <span>Version: ${escapeHtml(data.systemInfo.version || 'N/A')}</span>
            <span>Uptime: ${formatUptime(data.systemInfo.uptime_seconds)}</span>
          </div></div>`;
      }
      if (data.alerts?.length) {
        html += '<div class="truenas-section"><h4>Alerts</h4>';
        for (const alert of data.alerts.slice(0, 3)) {
          const lvl = (alert.level || 'INFO').toUpperCase();
          const cls = lvl === 'CRITICAL' ? 'status-down' :
                      lvl === 'WARNING'  ? 'status-warn' : 'status-info';
          html += `<div class="alert-item ${cls}">${escapeHtml(alert.formatted || alert.message || 'Alert')}</div>`;
        }
        html += '</div>';
      } else {
        html += '<div class="truenas-section"><h4>Alerts</h4><span class="text-muted">No active alerts</span></div>';
      }
      root.innerHTML = html;
    },
  });

  // ── Finance ────────────────────────────────────────────────────────────
  register({
    id: 'finance',
    dataSource: 'finance',
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Loading...</span></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      const rates = [
        { label: '30-Yr Mortgage', key: 'mortgage30', suffix: '%' },
        { label: '15-Yr Mortgage', key: 'mortgage15', suffix: '%' },
        { label: '10-Yr Treasury', key: 'treasury10', suffix: '%' },
        { label: '2-Yr Treasury',  key: 'treasury2',  suffix: '%' },
      ];
      root.innerHTML = '<div class="rate-grid">' + rates.map((r) => {
        const d = data?.[r.key];
        if (!d?.value) {
          return `<div class="rate-card"><div class="rate-label">${r.label}</div>
            <div class="rate-value text-muted">N/A</div></div>`;
        }
        return `<div class="rate-card"><div class="rate-label">${r.label}</div>
          <div class="rate-value">${escapeHtml(d.value)}${r.suffix}</div>
          <div class="rate-date">as of ${escapeHtml(d.date)}</div></div>`;
      }).join('') + '</div>';
    },
  });

  // ── Stocks ─────────────────────────────────────────────────────────────
  register({
    id: 'stocks',
    dataSource: 'stocks',
    dataQuery(ctx) {
      const symbols = ctx.config?.symbols || 'SPY,DIA,QQQ';
      return `symbols=${encodeURIComponent(symbols)}`;
    },
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Loading...</span></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      if (!Array.isArray(data)) {
        root.innerHTML = '<span class="text-muted">No data</span>';
        return;
      }
      root.innerHTML = data.map((s) => {
        const cls = (s.change || 0) >= 0 ? 'positive' : 'negative';
        const arrow = (s.change || 0) >= 0 ? '▲' : '▼';
        return `<div class="stock-item">
          <div><div class="stock-name">${escapeHtml(s.name)}</div>
               <div class="stock-symbol">${escapeHtml(s.symbol)}</div></div>
          <div style="text-align:right">
            <div class="stock-price">$${(s.price || 0).toFixed(2)}</div>
            <div class="stock-change ${cls}">${arrow} ${Math.abs(s.change || 0).toFixed(2)} (${Math.abs(s.changePercent || 0).toFixed(2)}%)</div>
          </div></div>`;
      }).join('');
    },
  });

  // ── Deliveries ─────────────────────────────────────────────────────────
  register({
    id: 'deliveries',
    dataSource: 'deliveries',
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Loading...</span></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      if (!data?.length) {
        root.innerHTML = '<span class="text-muted">No active deliveries</span>';
        return;
      }
      root.innerHTML = data.map((d) => {
        const sc = d.status === 'Delivered' ? 'status-up' :
                   d.status === 'Error'     ? 'status-down' : 'status-warn';
        return `<div class="delivery-item">
          <div class="delivery-header">
            <span class="delivery-carrier">${escapeHtml(d.carrier)}</span>
            <span class="delivery-status ${sc}">${escapeHtml(d.status)}</span>
          </div>
          <div class="delivery-tracking">${escapeHtml(d.number)}</div>
          ${d.eta ? `<div class="delivery-detail">ETA: ${escapeHtml(d.eta)}</div>` : ''}
          ${d.lastUpdate ? `<div class="delivery-detail">${escapeHtml(d.lastUpdate)}</div>` : ''}
        </div>`;
      }).join('');
    },
  });

  // ── News ───────────────────────────────────────────────────────────────
  register({
    id: 'news',
    dataSource: 'news',
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Loading...</span></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      if (!data?.length) {
        root.innerHTML = '<span class="text-muted">No headlines</span>';
        return;
      }
      root.innerHTML = data.map((a) => `
        <div class="news-item">
          <div class="news-title">${a.emoji ? escapeHtml(a.emoji) + ' ' : ''}${escapeHtml(a.title)}</div>
          <div class="news-source">${a.sources} sources</div>
        </div>`).join('');
    },
  });

  // ── Calendar ───────────────────────────────────────────────────────────
  register({
    id: 'calendar',
    dataSource: 'calendar',
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Loading...</span></div>`;
    },
    update(el, data) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      if (!data?.length) {
        root.innerHTML = '<span class="text-muted">No upcoming events</span>';
        return;
      }
      root.innerHTML = data.map((ev) => {
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
            <div class="cal-summary">${escapeHtml(ev.summary)}</div>
            <div class="cal-time">${time}</div>
            ${ev.location ? `<div class="cal-location">📍 ${escapeHtml(ev.location)}</div>` : ''}
          </div></div>`;
      }).join('');
    },
  });

  // ── Text ────────────────────────────────────────────────────────────────
  register({
    id: 'text',
    dataSource: null,
    mount(el, ctx) {
      const cfg = ctx.config || {};
      el.innerHTML = `<div class="mod-body text-module">
        <div class="text-heading">${escapeHtml(cfg.heading || '')}</div>
        <div class="text-body">${escapeHtml(cfg.body || '')}</div>
      </div>`;
    },
    update(el, _data, ctx) {
      const cfg = ctx.config || {};
      const h = el.querySelector('.text-heading');
      const b = el.querySelector('.text-body');
      if (h) h.textContent = cfg.heading || '';
      if (b) b.textContent = cfg.body || '';
    },
  });

  // ── Key / Value ────────────────────────────────────────────────────────
  register({
    id: 'key-value',
    dataSource: 'custom',
    resolveSource(ctx) {
      return ctx.config?.sourceId || ctx.config?.builtInSource || null;
    },
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Configure source...</span></div>`;
    },
    update(el, data, ctx) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      const fields = (ctx.config?.fields || '')
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
        .map((f) => {
          const [label, ...pathParts] = f.split(':');
          return { label: label.trim(), path: pathParts.join(':').trim() || label.trim() };
        });
      if (!fields.length) {
        root.innerHTML = '<span class="text-muted">Add fields as label:path</span>';
        return;
      }
      root.innerHTML = '<div class="kv-grid">' + fields.map(({ label, path }) => {
        const val = getByPath(data, path);
        const display = val == null ? '—' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
        return `<div class="kv-row"><span class="kv-label">${escapeHtml(label)}</span>
          <span class="kv-value">${escapeHtml(display)}</span></div>`;
      }).join('') + '</div>';
    },
  });

  // ── JSON List ──────────────────────────────────────────────────────────
  register({
    id: 'json-list',
    dataSource: 'custom',
    resolveSource(ctx) {
      return ctx.config?.sourceId || ctx.config?.builtInSource || null;
    },
    mount(el) {
      el.innerHTML = `<div class="mod-body"><span class="text-muted">Configure source...</span></div>`;
    },
    update(el, data, ctx) {
      const root = el.querySelector('.mod-body') || el;
      if (data?.error) {
        root.innerHTML = `<span class="text-muted">${escapeHtml(data.error)}</span>`;
        return;
      }
      const cfg = ctx.config || {};
      let arr = cfg.arrayPath ? getByPath(data, cfg.arrayPath) : data;
      if (!Array.isArray(arr)) {
        root.innerHTML = '<span class="text-muted">Data is not an array</span>';
        return;
      }
      const limit = Number(cfg.limit) || 10;
      arr = arr.slice(0, limit);
      root.innerHTML = arr.map((item) => {
        const title = cfg.titlePath ? getByPath(item, cfg.titlePath) : (typeof item === 'object' ? JSON.stringify(item) : item);
        const sub = cfg.subtitlePath ? getByPath(item, cfg.subtitlePath) : '';
        return `<div class="news-item">
          <div class="news-title">${escapeHtml(title ?? '')}</div>
          ${sub != null && sub !== '' ? `<div class="news-source">${escapeHtml(sub)}</div>` : ''}
        </div>`;
      }).join('') || '<span class="text-muted">Empty list</span>';
    },
  });

  // ── iframe ─────────────────────────────────────────────────────────────
  register({
    id: 'iframe',
    dataSource: null,
    mount(el, ctx) {
      const url = ctx.config?.url || '';
      el.innerHTML = url
        ? `<iframe class="mod-iframe" src="${escapeHtml(url)}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`
        : `<div class="mod-body"><span class="text-muted">Set a URL in config</span></div>`;
      const sec = Number(ctx.config?.refreshSeconds) || 0;
      if (sec > 0 && url) {
        el._iframeTimer = setInterval(() => {
          const frame = el.querySelector('iframe');
          if (frame) frame.src = frame.src;
        }, sec * 1000);
      }
    },
    update(el, _data, ctx) {
      const url = ctx.config?.url || '';
      const frame = el.querySelector('iframe');
      if (frame && url && frame.getAttribute('src') !== url) frame.src = url;
    },
    unmount(el) {
      if (el._iframeTimer) clearInterval(el._iframeTimer);
    },
  });

  return { register, get, all };
})();
