const { contextBridge, ipcRenderer } = require('electron');

async function safeInvoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

contextBridge.exposeInMainWorld('fancheng', {
  getAppVersion: () => safeInvoke('get-app-version'),
  getDataQualityStatus: () => safeInvoke('get-data-quality-status'),
  runDataQualityAudit: (options) => safeInvoke('run-data-quality-audit', options),
  getPhilosophyManifest: () => safeInvoke('get-philosophy-manifest'),
  fetchAll: (options) => safeInvoke('fetch-all', options),
  fetchIndicesQuick: (options) => safeInvoke('fetch-indices-quick', options),
  getCachedIndices: () => safeInvoke('get-cached-indices'),
  getStartupSnapshot: () => safeInvoke('get-startup-snapshot'),
  onStartupData: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('startup-data', handler);
    return () => ipcRenderer.removeListener('startup-data', handler);
  },
  onDataRefreshed: (callback) => {
    const handler = (_event, payload) => {
      setTimeout(() => callback(payload), 0);
    };
    ipcRenderer.on('data-refreshed', handler);
    return () => ipcRenderer.removeListener('data-refreshed', handler);
  },
  fetchIndicesLive: () => safeInvoke('fetch-indices-live'),
  refreshIndexKline: (id, tf, klines) => safeInvoke('refresh-index-kline', id, tf, klines),
  fetchIndexHistory: (id, timeframe) => safeInvoke('fetch-index-history', id, timeframe),
  listIndicesHistory: () => safeInvoke('list-indices-history'),
  fetchCommoditiesLive: (options) => safeInvoke('fetch-commodities-live', options),
  fetchMacroLive: () => safeInvoke('fetch-macro-live'),
  fetchFedLive: () => safeInvoke('fetch-fed-live'),
  fetchBojLive: () => safeInvoke('fetch-boj-live'),
  fetchForexLive: (options) => safeInvoke('fetch-forex-live', options),
  fetchPolicyLive: (options) => safeInvoke('fetch-policy-live', options),
  fetchGeopoliticsLive: (options) => safeInvoke('fetch-geopolitics-live', options),
  fetchClimateLive: (options) => safeInvoke('fetch-climate-live', options),
  fetchOutlookLive: (options) => safeInvoke('fetch-outlook-live', options),
  invalidateOutlookCache: () => safeInvoke('invalidate-outlook-cache'),
  getOutlookHistory: (instrumentId, days) => safeInvoke('get-outlook-history', instrumentId, days),
  exportOutlookHistory: (instrumentId, days) => safeInvoke('export-outlook-history', instrumentId, days),
  exportOutlookVerificationAll: () => safeInvoke('export-outlook-verification-all'),
  exportOutlookSlotComparisonAll: (options) => safeInvoke('export-outlook-slot-comparison-all', options),
  exportOutlookSlotComparisonForInstrument: (instrumentId, options) =>
    safeInvoke('export-outlook-slot-comparison-for-instrument', instrumentId, options),
  showItemInFolder: (fullPath) => safeInvoke('show-item-in-folder', fullPath),
  getOutlookDailyCompare: (dateA, dateB) => safeInvoke('get-outlook-daily-compare', dateA, dateB),
  getIntelCenterPack: () => safeInvoke('get-intel-center-pack'),
  getIntelDailyDiff: () => safeInvoke('get-intel-daily-diff'),
  recordIntelAnalystAnnotation: (payload) => safeInvoke('record-intel-analyst-annotation', payload),
  approveIntelProcessWeights: (payload) => safeInvoke('approve-intel-process-weights', payload),
  rejectIntelProcessWeights: (payload) => safeInvoke('reject-intel-process-weights', payload),
  runIntelDebtOps: (payload) => safeInvoke('run-intel-debt-ops', payload),
  ackIntelFalseQuiet: (payload) => safeInvoke('ack-intel-false-quiet', payload),
  searchIntelMemory: (payload) => safeInvoke('search-intel-memory', payload),
  replayIntelMemoryClaim: (payload) => safeInvoke('replay-intel-memory-claim', payload),
  getIntelAnalystWorkbench: () => safeInvoke('get-intel-analyst-workbench'),
  getIntelInterruptChannel: () => safeInvoke('get-intel-interrupt-channel'),
  ackIntelInterrupt: (payload) => safeInvoke('ack-intel-interrupt', payload),
  muteIntelInterrupt: (payload) => safeInvoke('mute-intel-interrupt', payload),
  dispatchIntelInterruptNotifications: (notifications) =>
    safeInvoke('dispatch-intel-interrupt-notifications', notifications),
  bootstrapOutlookDaily: () => safeInvoke('bootstrap-outlook-daily'),
  captureOutlookSlot: (options) => safeInvoke('capture-outlook-slot', options),
  getOutlookSlotSnapshots: (sessionDate) => safeInvoke('get-outlook-slot-snapshots', sessionDate),
  getOutlookSlotHitRates: (options) => safeInvoke('get-outlook-slot-hit-rates', options),
  getChanStructureHints: (instrumentId, refPrice, sessionDate) =>
    safeInvoke('get-chan-structure-hints', instrumentId, refPrice, sessionDate),
  onOutlookSlotCaptured: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('outlook-slot-captured', handler);
    return () => ipcRenderer.removeListener('outlook-slot-captured', handler);
  },
  getRangePredictionArchive: (instrumentId, dateRange) =>
    safeInvoke('get-range-prediction-archive', instrumentId, dateRange),
  getDirectionPredictionArchive: (instrumentId, dateRange) =>
    safeInvoke('get-direction-prediction-archive', instrumentId, dateRange),
  runDirectionPredictionBackfill: (options) => safeInvoke('run-direction-prediction-backfill', options),
  runRangePredictionBackfill: (options) => safeInvoke('run-range-prediction-backfill', options),
  runOutlookBacktest: (options) => safeInvoke('run-outlook-backtest', options),
  getOutlookBacktestSummary: () => safeInvoke('get-outlook-backtest-summary'),
  getOutlookLongrunSummary: () => safeInvoke('get-outlook-longrun-summary'),
  getFanchengAiBrief: (instrumentId) => safeInvoke('get-fancheng-ai-brief', instrumentId),
  getMacroAiBrief: (options) => safeInvoke('get-macro-ai-brief', options),
  askFanchengAi: (question, instrumentId) => safeInvoke('ask-fancheng-ai', question, instrumentId),
  getLlmStatus: () => safeInvoke('get-llm-status'),
  getPortfolioHoldings: () => safeInvoke('get-portfolio-holdings'),
  setPortfolioHoldings: (holdings) => safeInvoke('set-portfolio-holdings', holdings),
  getDailyBrief: (options) => safeInvoke('get-daily-brief', options),
  getFocusDashboard: (options) => safeInvoke('get-focus-dashboard', options),
  getNewsCoverageAudit: (options) => safeInvoke('get-news-coverage-audit', options),
  getCommodityReleaseCalendar: (options) => safeInvoke('get-commodity-release-calendar', options),
  getOutlookHeadlines: (options) => safeInvoke('get-outlook-headlines', options),
  markImpactAlertsRead: (options) => safeInvoke('mark-impact-alerts-read', options),
  generateFocusAnalysis: (instrumentId, options) => safeInvoke('generate-focus-analysis', instrumentId, options),
  generateTop5DeepBrief: (instrumentId, options) => safeInvoke('generate-top5-deep-brief', instrumentId, options),
  getFocusNewsArticle: (symbol, newsId, options) => safeInvoke('get-focus-news-article', symbol, newsId, options),
  markFocusAnalysisRead: (instrumentId) => safeInvoke('mark-focus-analysis-read', instrumentId),
  getCursorStatus: () => safeInvoke('get-cursor-status'),
  getSlotDecisionBrief: (options) => safeInvoke('get-slot-decision-brief', options),
  getRedTeamWeekly: (options) => safeInvoke('get-red-team-weekly', options),
  logBehaviorOverride: (entry) => safeInvoke('log-behavior-override', entry),
  getBehaviorOverrideSummary: (symbol) => safeInvoke('get-behavior-override-summary', symbol),
  getPreMortem: (instrumentId, postureIntent) => safeInvoke('get-pre-mortem', instrumentId, postureIntent),
  checkPreMortemAck: (signalId) => safeInvoke('check-pre-mortem-ack', signalId),
  savePreMortemAck: (entry) => safeInvoke('save-pre-mortem-ack', entry),
  logPositionClose: (entry) => safeInvoke('log-position-close', entry),
  getReentryCooldown: (symbol) => safeInvoke('get-reentry-cooldown', symbol),
  getCoreTacticalState: (holdings) => safeInvoke('get-core-tactical-state', holdings),
  listPainEntries: (limit) => safeInvoke('list-pain-entries', limit),
  addPainEntry: (entry) => safeInvoke('add-pain-entry', entry),
  deletePainEntry: (id) => safeInvoke('delete-pain-entry', id),
  runMarginStress: (holdings, marginBumpPct) => safeInvoke('run-margin-stress', holdings, marginBumpPct),
  getHolidayGapRisk: (asOfDate) => safeInvoke('get-holiday-gap-risk', asOfDate),
  onOutlookBacktestProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('outlook-backtest-progress', handler);
    return () => ipcRenderer.removeListener('outlook-backtest-progress', handler);
  },
  onForexLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('forex-live', handler);
    return () => ipcRenderer.removeListener('forex-live', handler);
  },
  onPolicyLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('policy-live', handler);
    return () => ipcRenderer.removeListener('policy-live', handler);
  },
  onGeopoliticsLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('geopolitics-live', handler);
    return () => ipcRenderer.removeListener('geopolitics-live', handler);
  },
  onClimateLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('climate-live', handler);
    return () => ipcRenderer.removeListener('climate-live', handler);
  },
  onOutlookLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('outlook-live', handler);
    return () => ipcRenderer.removeListener('outlook-live', handler);
  },
  onOutlookQuotesUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('outlook-quotes-updated', handler);
    return () => ipcRenderer.removeListener('outlook-quotes-updated', handler);
  },
  onOutlookDataUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('outlook-data-updated', handler);
    return () => ipcRenderer.removeListener('outlook-data-updated', handler);
  },
  onFocusAnalysisUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('focus-analysis-updated', handler);
    return () => ipcRenderer.removeListener('focus-analysis-updated', handler);
  },
  onFocusIntelUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('focus-intel-updated', handler);
    return () => ipcRenderer.removeListener('focus-intel-updated', handler);
  },
  onOutlookHeadlinesUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('outlook-headlines-updated', handler);
    return () => ipcRenderer.removeListener('outlook-headlines-updated', handler);
  },
  onOutlookImpactAlert: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('outlook-impact-alert', handler);
    return () => ipcRenderer.removeListener('outlook-impact-alert', handler);
  },
  onCommoditiesLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('commodities-live', handler);
    return () => ipcRenderer.removeListener('commodities-live', handler);
  },
  onIndicesLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('indices-live', handler);
    return () => ipcRenderer.removeListener('indices-live', handler);
  },
  onWindowFocusChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('window-focus-changed', handler);
    return () => ipcRenderer.removeListener('window-focus-changed', handler);
  },
  setRendererState: (state) => safeInvoke('set-renderer-state', state),
  onFedLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('fed-live', handler);
    return () => ipcRenderer.removeListener('fed-live', handler);
  },
  onBojLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('boj-live', handler);
    return () => ipcRenderer.removeListener('boj-live', handler);
  },
  fetchCommodityHistory: (id, timeframe) => safeInvoke('fetch-commodity-history', id, timeframe),
  refreshCommodityKline: (id, tf, klines) => safeInvoke('refresh-commodity-kline', id, tf, klines),
  listCommoditiesHistory: () => safeInvoke('list-commodities-history'),
  fetchCommodityNews: (id) => safeInvoke('fetch-commodity-news', id),
  fetchCommodityCatalog: () => safeInvoke('get-commodity-catalog'),
  refreshCommodityNews: (id) => safeInvoke('refresh-commodity-news', id),
  warmCommodityNewsCache: () => safeInvoke('warm-commodity-news-cache'),
  invalidateCommodityNewsCache: () => safeInvoke('invalidate-commodity-news-cache'),
  getConfig: () => safeInvoke('get-config'),
  saveConfig: (partial) => safeInvoke('save-config', partial),
  testLlmConnection: () => safeInvoke('test-llm-connection'),
  testCursorConnection: () => safeInvoke('test-cursor-connection'),
  openExternal: (url) => safeInvoke('open-external', url),
  showNotification: (payload) => safeInvoke('show-notification', payload),
  fetchFlashNews: (options) => safeInvoke('fetch-flash-news', options),
  getFlashNewsInbox: () => safeInvoke('get-flash-news-inbox'),
  getFlashNewsSummary: () => safeInvoke('get-flash-news-summary'),
  addManualFlashNews: (payload) => safeInvoke('add-manual-flash-news', payload),
  onFlashNewsUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('flash-news-updated', handler);
    return () => ipcRenderer.removeListener('flash-news-updated', handler);
  },
  onDataQualityStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('data-quality-status', handler);
    return () => ipcRenderer.removeListener('data-quality-status', handler);
  },
});
