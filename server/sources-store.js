const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SOURCES_PATH = path.join(DATA_DIR, 'sources.json');
const DEFAULT_SOURCES_PATH = path.join(DATA_DIR, 'sources.default.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getDefaultSources() {
  return readJSON(DEFAULT_SOURCES_PATH);
}

function getSourcesDoc() {
  ensureDataDir();
  if (!fs.existsSync(SOURCES_PATH)) {
    const def = getDefaultSources();
    fs.writeFileSync(SOURCES_PATH, JSON.stringify(def, null, 2));
    return JSON.parse(JSON.stringify(def));
  }
  return readJSON(SOURCES_PATH);
}

function getSources() {
  return getSourcesDoc().sources || [];
}

function getSource(id) {
  return getSources().find((s) => s.id === id) || null;
}

function saveSources(sources) {
  ensureDataDir();
  const doc = {
    version: 1,
    sources: Array.isArray(sources) ? sources : [],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(doc, null, 2));
  return doc;
}

module.exports = { getSources, getSource, saveSources, getSourcesDoc };
