const fs = require('fs');
const path = require('path');

// Runtime layout lives in data/ (often a Docker volume).
// Defaults are bundled under defaults/ so a volume mount cannot hide them.
const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULTS_DIR = path.join(__dirname, '..', 'defaults');
const LAYOUT_PATH = path.join(DATA_DIR, 'layout.json');
const DEFAULT_LAYOUT_CANDIDATES = [
  path.join(DEFAULTS_DIR, 'layout.default.json'),
  path.join(DATA_DIR, 'layout.default.json'),
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveDefaultLayoutPath() {
  for (const candidate of DEFAULT_LAYOUT_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `layout.default.json not found (looked in ${DEFAULT_LAYOUT_CANDIDATES.join(', ')})`
  );
}

function getDefaultLayout() {
  return readJSON(resolveDefaultLayoutPath());
}

function getLayout() {
  ensureDataDir();
  if (!fs.existsSync(LAYOUT_PATH)) {
    const def = getDefaultLayout();
    fs.writeFileSync(LAYOUT_PATH, JSON.stringify(def, null, 2));
    return JSON.parse(JSON.stringify(def));
  }
  return readJSON(LAYOUT_PATH);
}

function saveLayout(layout) {
  ensureDataDir();
  const next = {
    ...layout,
    version: layout.version || 1,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(LAYOUT_PATH, JSON.stringify(next, null, 2));
  return next;
}

function resetLayout() {
  return saveLayout(getDefaultLayout());
}

module.exports = { getLayout, saveLayout, resetLayout, getDefaultLayout, LAYOUT_PATH };
