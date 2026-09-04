(function () {
  const state = {
    layout: null,
    modules: [],
    sources: [],
    selectedId: null,
    dirty: false,
  };

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const gridEl = $('editor-grid');
  const paletteEl = $('module-palette');
  const listEl = $('container-list');
  const form = $('inspector-form');
  const emptyInspector = $('inspector-empty');
  const configFields = $('module-config-fields');
  const sourcesList = $('sources-list');

  function tokenHeaders() {
    const token = $('editor-token').value.trim() || localStorage.getItem('dashboardEditorToken') || '';
    const h = { 'Content-Type': 'application/json' };
    if (token) h['x-editor-token'] = token;
    return h;
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#fca5a5' : '#9ca3af';
  }

  function markDirty() {
    state.dirty = true;
    setStatus('Unsaved changes');
    renderAll();
  }

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function moduleMeta(id) {
    return state.modules.find((m) => m.id === id) || null;
  }

  function selected() {
    return (state.layout?.containers || []).find((c) => c.id === state.selectedId) || null;
  }

  async function api(url, opts = {}) {
    const resp = await fetch(url, {
      ...opts,
      headers: { ...tokenHeaders(), ...(opts.headers || {}) },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  function ensureCanvasDefaults(layout) {
    layout.canvas = layout.canvas || {};
    layout.canvas.cols = layout.canvas.cols || 12;
    layout.canvas.rows = layout.canvas.rows || 12;
    layout.canvas.gap = layout.canvas.gap ?? 10;
    layout.canvas.padding = layout.canvas.padding ?? 10;
    layout.canvas.rotation = layout.canvas.rotation || 0;
    layout.canvas.scale = layout.canvas.scale ?? 1;
    layout.canvas.background = layout.canvas.background || '#0a0a0a';
    layout.containers = layout.containers || [];
    return layout;
  }

  function syncCanvasForm() {
    const c = state.layout.canvas;
    $('canvas-rotation').value = String(c.rotation || 0);
    $('canvas-cols').value = c.cols;
    $('canvas-rows').value = c.rows;
    $('canvas-gap').value = c.gap;
    $('canvas-padding').value = c.padding;
    $('canvas-scale').value = c.scale;
    $('canvas-bg').value = c.background || '#0a0a0a';
  }

  function readCanvasForm() {
    const c = state.layout.canvas;
    c.rotation = Number($('canvas-rotation').value) || 0;
    c.cols = Math.max(1, Number($('canvas-cols').value) || 12);
    c.rows = Math.max(1, Number($('canvas-rows').value) || 12);
    c.gap = Number($('canvas-gap').value) || 0;
    c.padding = Number($('canvas-padding').value) || 0;
    c.scale = Number($('canvas-scale').value) || 1;
    c.background = $('canvas-bg').value || '#0a0a0a';
  }

  function renderPalette() {
    paletteEl.innerHTML = state.modules.map((m) => `
      <button type="button" class="palette-item" data-module="${m.id}">
        ${escapeHtml(m.name)}
        <small>${escapeHtml(m.description || m.category || '')}</small>
      </button>`).join('');
  }

  function renderList() {
    listEl.innerHTML = (state.layout.containers || []).map((c) => {
      const meta = moduleMeta(c.moduleId);
      const label = c.title || meta?.name || c.moduleId;
      return `<button type="button" data-id="${c.id}" class="${c.id === state.selectedId ? 'active' : ''}">
        ${escapeHtml(label)} <span class="muted">(${escapeHtml(c.moduleId)})</span>
      </button>`;
    }).join('');
  }

  function cellSize() {
    const cols = state.layout.canvas.cols || 12;
    const rows = state.layout.canvas.rows || 12;
    const rect = gridEl.getBoundingClientRect();
    return { cw: rect.width / cols, ch: rect.height / rows, cols, rows };
  }

  function renderGrid() {
    const c = state.layout.canvas;
    gridEl.style.setProperty('--cols', c.cols);
    gridEl.style.setProperty('--rows', c.rows);
    gridEl.style.backgroundColor = c.background || '#0a0a0a';
    gridEl.innerHTML = '';

    for (const item of state.layout.containers) {
      if (item.enabled === false) continue;
      const el = document.createElement('div');
      el.className = 'editor-item' + (item.id === state.selectedId ? ' selected' : '');
      el.dataset.id = item.id;
      const left = (item.x / c.cols) * 100;
      const top = (item.y / c.rows) * 100;
      const width = (item.w / c.cols) * 100;
      const height = (item.h / c.rows) * 100;
      el.style.left = `${left}%`;
      el.style.top = `${top}%`;
      el.style.width = `${width}%`;
      el.style.height = `${height}%`;
      const meta = moduleMeta(item.moduleId);
      el.innerHTML = `
        <div class="item-title">${escapeHtml(item.title || meta?.name || item.moduleId)}</div>
        <div class="item-meta">${item.x},${item.y} · ${item.w}×${item.h} · scale ${item.style?.scale ?? 1}</div>
        <div class="resize-handle" data-resize="1"></div>`;
      gridEl.appendChild(el);
      bindItemInteractions(el, item);
    }
  }

  function bindItemInteractions(el, item) {
    el.addEventListener('pointerdown', (e) => {
      state.selectedId = item.id;
      renderInspector();
      renderList();
      [...gridEl.children].forEach((n) => n.classList.toggle('selected', n.dataset.id === item.id));

      const isResize = e.target.dataset.resize === '1';
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { x: item.x, y: item.y, w: item.w, h: item.h };
      el.setPointerCapture(e.pointerId);

      function onMove(ev) {
        const { cw, ch, cols, rows } = cellSize();
        const dx = Math.round((ev.clientX - startX) / cw);
        const dy = Math.round((ev.clientY - startY) / ch);
        if (isResize) {
          item.w = clamp(orig.w + dx, 1, cols - item.x);
          item.h = clamp(orig.h + dy, 1, rows - item.y);
        } else {
          item.x = clamp(orig.x + dx, 0, cols - item.w);
          item.y = clamp(orig.y + dy, 0, rows - item.h);
        }
        state.dirty = true;
        setStatus('Unsaved changes');
        // live position
        const c = state.layout.canvas;
        el.style.left = `${(item.x / c.cols) * 100}%`;
        el.style.top = `${(item.y / c.rows) * 100}%`;
        el.style.width = `${(item.w / c.cols) * 100}%`;
        el.style.height = `${(item.h / c.rows) * 100}%`;
        el.querySelector('.item-meta').textContent =
          `${item.x},${item.y} · ${item.w}×${item.h} · scale ${item.style?.scale ?? 1}`;
        if (state.selectedId === item.id) {
          form.x.value = item.x;
          form.y.value = item.y;
          form.w.value = item.w;
          form.h.value = item.h;
        }
      }

      function onUp() {
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        renderList();
      }

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function defaultConfig(meta) {
    const cfg = {};
    for (const f of meta?.configSchema || []) cfg[f.key] = f.default ?? '';
    return cfg;
  }

  function addModule(moduleId) {
    const meta = moduleMeta(moduleId);
    if (!meta) return;
    const id = uid(moduleId);
    const container = {
      id,
      moduleId,
      title: meta.name || moduleId,
      x: 0,
      y: 0,
      w: meta.defaultSize?.w || 4,
      h: meta.defaultSize?.h || 2,
      enabled: true,
      refreshMs: meta.defaultRefreshMs ?? 60000,
      style: {
        scale: 1,
        opacity: 1,
        showChrome: meta.defaultStyle?.showChrome !== false,
      },
      config: defaultConfig(meta),
    };
    // place without total overlap if possible
    const cols = state.layout.canvas.cols;
    const rows = state.layout.canvas.rows;
    outer: for (let y = 0; y <= rows - container.h; y++) {
      for (let x = 0; x <= cols - container.w; x++) {
        const hits = state.layout.containers.some((c) =>
          !(x + container.w <= c.x || c.x + c.w <= x || y + container.h <= c.y || c.y + c.h <= y)
        );
        if (!hits) {
          container.x = x;
          container.y = y;
          break outer;
        }
      }
    }
    state.layout.containers.push(container);
    state.selectedId = id;
    markDirty();
  }

  function renderInspector() {
    const item = selected();
    if (!item) {
      form.classList.add('hidden');
      emptyInspector.classList.remove('hidden');
      return;
    }
    emptyInspector.classList.add('hidden');
    form.classList.remove('hidden');
    form.id.value = item.id;
    form.moduleId.value = item.moduleId;
    form.title.value = item.title || '';
    form.x.value = item.x;
    form.y.value = item.y;
    form.w.value = item.w;
    form.h.value = item.h;
    form.refreshMs.value = item.refreshMs ?? '';
    form.styleScale.value = item.style?.scale ?? 1;
    form.styleOpacity.value = item.style?.opacity ?? 1;
    form.enabled.checked = item.enabled !== false;
    form.showChrome.checked = item.style?.showChrome !== false;

    const meta = moduleMeta(item.moduleId);
    const schema = meta?.configSchema || [];
    configFields.innerHTML = schema.map((f) => {
      const val = item.config?.[f.key] ?? f.default ?? '';
      if (f.type === 'textarea') {
        return `<label>${escapeHtml(f.label)}<textarea name="cfg_${f.key}" rows="4">${escapeHtml(val)}</textarea></label>`;
      }
      const type = f.type === 'number' ? 'number' : 'text';
      return `<label>${escapeHtml(f.label)}<input name="cfg_${f.key}" type="${type}" value="${escapeHtml(val)}"></label>`;
    }).join('') || '<p class="muted">No module-specific settings</p>';
  }

  function applyInspectorToSelected() {
    const item = selected();
    if (!item) return;
    item.title = form.title.value;
    item.x = Number(form.x.value) || 0;
    item.y = Number(form.y.value) || 0;
    item.w = Math.max(1, Number(form.w.value) || 1);
    item.h = Math.max(1, Number(form.h.value) || 1);
    item.refreshMs = form.refreshMs.value === '' ? null : Number(form.refreshMs.value);
    item.enabled = form.enabled.checked;
    item.style = item.style || {};
    item.style.scale = Number(form.styleScale.value) || 1;
    item.style.opacity = Number(form.styleOpacity.value) || 1;
    item.style.showChrome = form.showChrome.checked;
    item.config = item.config || {};
    const meta = moduleMeta(item.moduleId);
    for (const f of meta?.configSchema || []) {
      const input = form.querySelector(`[name="cfg_${f.key}"]`);
      if (!input) continue;
      item.config[f.key] = f.type === 'number' ? Number(input.value) : input.value;
    }
  }

  function renderSources() {
    sourcesList.innerHTML = state.sources.map((s, idx) => `
      <div class="source-card" data-idx="${idx}">
        <label>ID <input data-k="id" value="${escapeHtml(s.id || '')}"></label>
        <label>Name <input data-k="name" value="${escapeHtml(s.name || '')}"></label>
        <label>URL <input data-k="url" value="${escapeHtml(s.url || '')}"></label>
        <label>Method
          <select data-k="method">
            ${['GET','POST','PUT','PATCH','DELETE'].map((m) =>
              `<option ${((s.method || 'GET') === m) ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
        <label>JSON path <input data-k="jsonPath" value="${escapeHtml(s.jsonPath || '')}"></label>
        <label>Headers JSON <textarea data-k="headersJson" rows="2">${escapeHtml(JSON.stringify(s.headers || {}, null, 0))}</textarea></label>
        <label>Body <textarea data-k="body" rows="2">${escapeHtml(typeof s.body === 'string' ? s.body : (s.body ? JSON.stringify(s.body) : ''))}</textarea></label>
        <div class="row-actions"><button type="button" class="btn danger btn-del-source" data-idx="${idx}">Delete</button></div>
      </div>`).join('') || '<p class="muted">No custom sources yet</p>';
  }

  function readSourcesFromDom() {
    const cards = [...sourcesList.querySelectorAll('.source-card')];
    state.sources = cards.map((card) => {
      let headers = {};
      try { headers = JSON.parse(card.querySelector('[data-k="headersJson"]').value || '{}'); }
      catch { headers = {}; }
      return {
        id: card.querySelector('[data-k="id"]').value.trim(),
        name: card.querySelector('[data-k="name"]').value.trim(),
        url: card.querySelector('[data-k="url"]').value.trim(),
        method: card.querySelector('[data-k="method"]').value,
        jsonPath: card.querySelector('[data-k="jsonPath"]').value.trim(),
        headers,
        body: card.querySelector('[data-k="body"]').value,
      };
    }).filter((s) => s.id && s.url);
  }

  function renderAll() {
    syncCanvasForm();
    renderPalette();
    renderList();
    renderGrid();
    renderInspector();
    renderSources();
  }

  async function loadAll() {
    setStatus('Loading…');
    const token = localStorage.getItem('dashboardEditorToken');
    if (token) $('editor-token').value = token;
    const [layout, modules, sourcesDoc] = await Promise.all([
      api('/api/layout'),
      api('/api/modules'),
      api('/api/sources'),
    ]);
    state.layout = ensureCanvasDefaults(layout);
    state.modules = modules;
    state.sources = sourcesDoc.sources || [];
    state.dirty = false;
    state.selectedId = state.layout.containers[0]?.id || null;
    renderAll();
    setStatus('Ready');
  }

  async function saveLayout() {
    readCanvasForm();
    applyInspectorToSelected();
    const saved = await api('/api/layout', {
      method: 'PUT',
      body: JSON.stringify(state.layout),
    });
    state.layout = ensureCanvasDefaults(saved);
    state.dirty = false;
    setStatus(`Saved ${saved.updatedAt || ''}`.trim());
    renderAll();
  }

  async function saveSources() {
    readSourcesFromDom();
    const doc = await api('/api/sources', {
      method: 'PUT',
      body: JSON.stringify({ sources: state.sources }),
    });
    state.sources = doc.sources || [];
    setStatus('Sources saved');
    renderSources();
  }

  // Events
  paletteEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-module]');
    if (!btn) return;
    addModule(btn.dataset.module);
  });

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    applyInspectorToSelected();
    state.selectedId = btn.dataset.id;
    renderAll();
  });

  form.addEventListener('input', () => {
    applyInspectorToSelected();
    markDirty();
  });

  ['canvas-rotation','canvas-cols','canvas-rows','canvas-gap','canvas-padding','canvas-scale','canvas-bg']
    .forEach((id) => {
      $(id).addEventListener('change', () => {
        readCanvasForm();
        markDirty();
      });
      $(id).addEventListener('input', () => {
        readCanvasForm();
        markDirty();
      });
    });

  $('btn-save').addEventListener('click', async () => {
    try { await saveLayout(); }
    catch (err) { setStatus(err.message, true); }
  });

  $('btn-reload').addEventListener('click', async () => {
    try { await loadAll(); }
    catch (err) { setStatus(err.message, true); }
  });

  $('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset layout to default?')) return;
    try {
      const saved = await api('/api/layout/reset', { method: 'POST', body: '{}' });
      state.layout = ensureCanvasDefaults(saved);
      state.selectedId = state.layout.containers[0]?.id || null;
      state.dirty = false;
      renderAll();
      setStatus('Reset to default');
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  $('btn-export').addEventListener('click', () => {
    readCanvasForm();
    applyInspectorToSelected();
    const blob = new Blob([JSON.stringify(state.layout, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dashboard-layout.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      state.layout = ensureCanvasDefaults(json);
      state.selectedId = state.layout.containers[0]?.id || null;
      markDirty();
      setStatus('Imported (not saved yet)');
    } catch (err) {
      setStatus(err.message, true);
    }
    e.target.value = '';
  });

  $('btn-delete').addEventListener('click', () => {
    if (!state.selectedId) return;
    state.layout.containers = state.layout.containers.filter((c) => c.id !== state.selectedId);
    state.selectedId = state.layout.containers[0]?.id || null;
    markDirty();
  });

  $('btn-duplicate').addEventListener('click', () => {
    const item = selected();
    if (!item) return;
    const copy = JSON.parse(JSON.stringify(item));
    copy.id = uid(item.moduleId);
    copy.title = (item.title || item.moduleId) + ' copy';
    copy.x = Math.min(item.x + 1, (state.layout.canvas.cols || 12) - item.w);
    copy.y = Math.min(item.y + 1, (state.layout.canvas.rows || 12) - item.h);
    state.layout.containers.push(copy);
    state.selectedId = copy.id;
    markDirty();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  $('btn-add-source').addEventListener('click', () => {
    readSourcesFromDom();
    state.sources.push({
      id: uid('src'),
      name: 'New source',
      url: 'https://',
      method: 'GET',
      headers: {},
      jsonPath: '',
      body: '',
    });
    renderSources();
  });

  sourcesList.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-del-source');
    if (!btn) return;
    readSourcesFromDom();
    state.sources.splice(Number(btn.dataset.idx), 1);
    renderSources();
  });

  $('btn-save-sources').addEventListener('click', async () => {
    try { await saveSources(); }
    catch (err) { setStatus(err.message, true); }
  });

  $('editor-token').addEventListener('change', () => {
    localStorage.setItem('dashboardEditorToken', $('editor-token').value.trim());
  });

  window.addEventListener('resize', () => renderGrid());

  loadAll().catch((err) => setStatus(err.message, true));
})();
