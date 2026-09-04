const MODULES = [
  {
    id: 'clock', name: 'Clock', description: 'Local time and date', category: 'system',
    dataSource: null, defaultSize: { w: 3, h: 1 }, defaultRefreshMs: 1000,
    defaultStyle: { showChrome: false },
    configSchema: [
      { key: 'timeZone', label: 'Time zone', type: 'string', default: 'America/Denver' },
      { key: 'timeZoneLabel', label: 'TZ label', type: 'string', default: 'MST' },
    ],
  },
  {
    id: 'weather', name: 'Weather', description: 'Open-Meteo conditions', category: 'info',
    dataSource: 'weather', defaultSize: { w: 3, h: 1 }, defaultRefreshMs: 600000,
    defaultStyle: { showChrome: false }, configSchema: [],
  },
  {
    id: 'chaos', name: 'Chaos Index', description: 'Kagi chaos index', category: 'info',
    dataSource: 'chaos', defaultSize: { w: 1, h: 1 }, defaultRefreshMs: 1800000,
    defaultStyle: { showChrome: false }, configSchema: [],
  },
  {
    id: 'network', name: 'Network', description: 'Ping status dots', category: 'infra',
    dataSource: 'network', defaultSize: { w: 5, h: 1 }, defaultRefreshMs: 60000,
    defaultStyle: { showChrome: false }, configSchema: [],
  },
  {
    id: 'services', name: 'Services', description: 'HTTP health checks', category: 'infra',
    dataSource: 'services', defaultSize: { w: 6, h: 4 }, defaultRefreshMs: 60000,
    defaultStyle: { showChrome: true }, configSchema: [],
  },
  {
    id: 'truenas', name: 'TrueNAS', description: 'Pools, system, alerts', category: 'infra',
    dataSource: 'truenas', defaultSize: { w: 6, h: 4 }, defaultRefreshMs: 30000,
    defaultStyle: { showChrome: true }, configSchema: [],
  },
  {
    id: 'finance', name: 'Rates', description: 'Mortgage & treasury', category: 'finance',
    dataSource: 'finance', defaultSize: { w: 6, h: 3 }, defaultRefreshMs: 300000,
    defaultStyle: { showChrome: true }, configSchema: [],
  },
  {
    id: 'stocks', name: 'Market', description: 'Yahoo Finance quotes', category: 'finance',
    dataSource: 'stocks', defaultSize: { w: 6, h: 3 }, defaultRefreshMs: 300000,
    defaultStyle: { showChrome: true },
    configSchema: [
      { key: 'symbols', label: 'Symbols (comma-separated)', type: 'string', default: 'SPY,DIA,QQQ' },
    ],
  },
  {
    id: 'deliveries', name: 'Deliveries', description: 'AfterShip tracking', category: 'info',
    dataSource: 'deliveries', defaultSize: { w: 4, h: 4 }, defaultRefreshMs: 900000,
    defaultStyle: { showChrome: true }, configSchema: [],
  },
  {
    id: 'news', name: 'Headlines', description: 'Kagi News', category: 'info',
    dataSource: 'news', defaultSize: { w: 4, h: 4 }, defaultRefreshMs: 1800000,
    defaultStyle: { showChrome: true }, configSchema: [],
  },
  {
    id: 'calendar', name: 'Calendar', description: 'Nextcloud events', category: 'info',
    dataSource: 'calendar', defaultSize: { w: 4, h: 4 }, defaultRefreshMs: 300000,
    defaultStyle: { showChrome: true }, configSchema: [],
  },
  {
    id: 'text', name: 'Text / Info', description: 'Static text block', category: 'custom',
    dataSource: null, defaultSize: { w: 4, h: 2 }, defaultRefreshMs: null,
    defaultStyle: { showChrome: true },
    configSchema: [
      { key: 'heading', label: 'Heading', type: 'string', default: 'Info' },
      { key: 'body', label: 'Body', type: 'textarea', default: '' },
    ],
  },
  {
    id: 'key-value', name: 'Key / Value', description: 'Labeled fields from a source', category: 'custom',
    dataSource: 'custom', defaultSize: { w: 4, h: 3 }, defaultRefreshMs: 60000,
    defaultStyle: { showChrome: true },
    configSchema: [
      { key: 'sourceId', label: 'Custom source ID', type: 'string', default: '' },
      { key: 'builtInSource', label: 'Or built-in source', type: 'string', default: '' },
      { key: 'fields', label: 'Fields (label:path,...)', type: 'string', default: '' },
    ],
  },
  {
    id: 'json-list', name: 'JSON List', description: 'List items from a source array', category: 'custom',
    dataSource: 'custom', defaultSize: { w: 4, h: 4 }, defaultRefreshMs: 60000,
    defaultStyle: { showChrome: true },
    configSchema: [
      { key: 'sourceId', label: 'Custom source ID', type: 'string', default: '' },
      { key: 'builtInSource', label: 'Or built-in source', type: 'string', default: '' },
      { key: 'arrayPath', label: 'Array path', type: 'string', default: '' },
      { key: 'titlePath', label: 'Title path', type: 'string', default: '' },
      { key: 'subtitlePath', label: 'Subtitle path', type: 'string', default: '' },
      { key: 'limit', label: 'Limit', type: 'number', default: 10 },
    ],
  },
  {
    id: 'iframe', name: 'Embed / iframe', description: 'Embed external URL', category: 'custom',
    dataSource: null, defaultSize: { w: 6, h: 4 }, defaultRefreshMs: null,
    defaultStyle: { showChrome: true },
    configSchema: [
      { key: 'url', label: 'URL', type: 'string', default: '' },
      { key: 'refreshSeconds', label: 'Reload every N seconds (0=off)', type: 'number', default: 0 },
    ],
  },
];

function listModules() { return MODULES; }
function getModule(id) { return MODULES.find((m) => m.id === id) || null; }

module.exports = { listModules, getModule, MODULES };
