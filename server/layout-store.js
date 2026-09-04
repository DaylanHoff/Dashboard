const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LAYOUT_PATH = path.join(DATA_DIR, 'layout.json');
const DEFAULT_LAYOUT_PATH = path.join(DATA_DIR, 'layout.default.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getDefaultLayout() {
  return readJSON(DEFAULT_LAYOUT_PATH);
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
