// The application uses ordered classic scripts with shared globals, not modules.
const shared = [
  '$', 'esc', 'icon', 'state', 'renderVersion', 'canOpen', 'stamp', 'localTime',
  'notify', 'api', 'field', 'check', 'options', 'select', 'metrics', 'shell',
  'loginPage', 'reservationRow', 'openingParams', 'receiptPanel', 'openingPage',
  'FormState', 'FrontendMock', 'FrontendPickers', 'servicePages',
  'canInbound', 'occurredText', 'inboundMissing', 'localInboundTime',
  'inboundParameters', 'inboundReceipt', 'inboundImpact', 'inboundPage', 'pendingPage',
  'movementTypes', 'hasPermission', 'movementLink', 'movementParameters',
  'basisLabel', 'reservationDetails', 'movementReceipt', 'movementTimeFields',
  'movementPage', 'reservationsPage', 'ledgerPage', 'warehouseCandidates',
  'inventoryResults', 'inventoryPage', 'correctionNames', 'documentNames',
  'correctionParameters', 'correctionReceipt', 'correctionPage', 'reconciliationPage',
  'coverageNames', 'statisticsPage', 'catalogPage', 'customersPage',
  'isMockMode', 'homePage', 'serviceDraftPage', 'serviceSearchPage',
  'serviceDetailPage', 'repairPage', 'settingsPage', 'customerPage',
  'sourcesPage','sourcePage','agentHomePage','agentTaskPage','agentTaskRows','agentSettingsPage','ServiceMockStore', 'servicePendingItems', 'resetServiceMock', 'loadCatalog', 'render',
];
const browser = [
  'window', 'document', 'location', 'navigator', 'history', 'fetch', 'Headers',
  'Request', 'Response', 'FormData', 'URL', 'URLSearchParams', 'AbortController',
  'MutationObserver', 'FileReader', 'Event', 'CustomEvent', 'HTMLElement', 'HTMLSelectElement',
  'HTMLInputElement', 'Node', 'NodeFilter', 'crypto', 'localStorage', 'sessionStorage',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'console', 'structuredClone',
  'getComputedStyle', 'confirm', 'alert', 'module',
];
const rules = {
  'no-undef': 'error',
  'no-redeclare': ['error', { builtinGlobals: false }],
  'no-dupe-args': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'valid-typeof': 'error',
  'constructor-super': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_|^('+shared.join('|')+')$' }],
};
export default [
  { ignores: ['prototypes/**', 'dist/**', 'node_modules/**'] },
  {
    files: ['app/web/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'script',
      globals: Object.fromEntries([...shared, ...browser].map(name => [name, 'readonly'])),
    },
    rules,
  },
  {
    files: ['scripts/frontend-*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
    rules,
  },
];
