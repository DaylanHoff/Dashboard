// Layout-driven dashboard runtime
(function () {
  const root = document.getElementById('dashboard-root');
  const board = document.getElementById('dashboard');
  let layout = null;
  let appConfig = {};
  const instances = new Map(); // id -> { el, container, module, timers }

  async function fetchJSON(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      return { error: err.message };
    }
  }

  function applyCanvas(canvas) {
    const c = canvas || {};
    const cols = c.cols || 12;
    const rows = c.rows || 12;
    const gap = c.gap ?? 10;
    const padding = c.padding ?? 10;
    const rotation = Number(c.rotation) || 0;
    const scale = c.scale ?? 1;
    const bg = c.background || '#0a0a0a';

    document.body.style.background = bg;
    root.style.background = bg;

    board.style.display = 'grid';
    board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    board.style.gap = `${gap}px`;
    board.style.padding = `${padding}px`;
    board.style.width = '100%';
    board.style.height = '100%';
    board.style.boxSizing = 'border-box';

    // Rotation + scale on root wrapper
    const swap = rotation === 90 || rotation === 270;
    root.style.width = swap ? '100vh' : '100vw';
    root.style.height = swap ? '100vw' : '100vh';
    root.style.position = 'fixed';
    root.style.left = '50%';
    root.style.top = '50%';
    root.style.transformOrigin = 'center center';
    root.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
  }

  function clearBoard() {
    for (const inst of instances.values()) {
      if (inst.module?.unmount) {
        try { inst.module.unmount(inst.contentEl); } catch { /* ignore */ }
      }
      for (const t of inst.timers || []) clearInterval(t);
    }
    instances.clear();
    board.innerHTML = '';
  }

  function makeWidgetShell(container) {
    const el = document.createElement('div');
    el.className = 'widget dash-container';
    el.dataset.id = container.id;
    el.style.gridColumn = `${(container.x || 0) + 1} / span ${container.w || 1}`;
    el.style.gridRow = `${(container.y || 0) + 1} / span ${container.h || 1}`;
    el.style.opacity = container.style?.opacity ?? 1;
    const scale = container.style?.scale ?? 1;
    if (scale !== 1) {
      el.style.transform = `scale(${scale})`;
      el.style.transformOrigin = 'top left';
    }
    const showChrome = container.style?.showChrome !== false;
    if (!showChrome) {
      el.classList.add('widget-bare');
    }
    if (showChrome && container.title) {
      const header = document.createElement('div');
      header.className = 'widget-header';
      header.textContent = container.title;
      el.appendChild(header);
    }
    const body = document.createElement('div');
    body.className = 'widget-body module-host';
    el.appendChild(body);
    return { el, body };
  }

  function resolveSource(mod, container) {
    const ctx = { config: container.config || {}, appConfig };
    if (typeof mod.resolveSource === 'function') {
      return mod.resolveSource(ctx);
    }
    if (mod.dataSource && mod.dataSource !== 'custom') return mod.dataSource;
    return null;
  }

  async function refreshInstance(inst) {
    const { module: mod, container, contentEl } = inst;
    const ctx = { config: container.config || {}, appConfig, container };
    if (!mod.update) return;

    const source = resolveSource(mod, container);
    let data = null;
    if (source) {
      let url = `/api/data/${encodeURIComponent(source)}`;
      if (typeof mod.dataQuery === 'function') {
        const q = mod.dataQuery(ctx);
        if (q) url += `?${q}`;
      }
      data = await fetchJSON(url);
    }
    try {
      mod.update(contentEl, data, ctx);
    } catch (err) {
      contentEl.innerHTML = `<span class="text-muted">${err.message}</span>`;
    }
  }

  function mountContainer(container) {
    if (container.enabled === false) return;
    const mod = window.DashboardModules.get(container.moduleId);
    const { el, body } = makeWidgetShell(container);
    board.appendChild(el);

    if (!mod) {
      body.innerHTML = `<span class="text-muted">Unknown module: ${container.moduleId}</span>`;
      return;
    }

    const ctx = { config: container.config || {}, appConfig, container };
    try {
      mod.mount(body, ctx);
    } catch (err) {
      body.innerHTML = `<span class="text-muted">${err.message}</span>`;
    }

    const timers = [];
    const inst = { el, contentEl: body, container, module: mod, timers };
    instances.set(container.id, inst);

    const needsData = resolveSource(mod, container) || mod.update;
    if (needsData) {
      refreshInstance(inst);
      const ms = container.refreshMs;
      if (ms && ms > 0) {
        timers.push(setInterval(() => refreshInstance(inst), ms));
      }
    }
  }

  function renderLayout(next) {
    layout = next;
    clearBoard();
    applyCanvas(layout.canvas);
    for (const c of layout.containers || []) mountContainer(c);
  }

  async function load() {
    appConfig = await fetchJSON('/api/config');
    if (appConfig.error) appConfig = {};
    const lay = await fetchJSON('/api/layout');
    if (lay.error) {
      board.innerHTML = `<div class="text-muted" style="padding:2rem">Failed to load layout: ${lay.error}</div>`;
      return;
    }
    renderLayout(lay);
  }

  function watchLayout() {
    try {
      const es = new EventSource('/api/layout/stream');
      es.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'layout') {
            const lay = await fetchJSON('/api/layout');
            if (!lay.error) renderLayout(lay);
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        // browser reconnects automatically
      };
    } catch {
      setInterval(async () => {
        const lay = await fetchJSON('/api/layout');
        if (!lay.error && lay.updatedAt !== layout?.updatedAt) renderLayout(lay);
      }, 5000);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await load();
    watchLayout();
  });
})();
