const path = require('path');
const fs = require('fs');

(function bootstrapFanchengDataDir() {
  if (process.env.FANCHENG_DATA_DIR) return;
  try {
    const { resolveExternalRoot } = require('../services/data-paths');
    const root = resolveExternalRoot();
    if (root) {
      process.env.FANCHENG_DATA_DIR = path.resolve(root);
      return;
    }
  } catch {
    // fallback below
  }
  const appRoot = process.env.FANCHENG_APP_ROOT || 'F:\\FanchengFinance';
  const drive = String(process.env.FANCHENG_DATA_DRIVE || 'F')
    .replace(':', '')
    .toUpperCase()
    .slice(0, 1);
  const candidates = [appRoot, `${drive}:\\FanchengFinance`].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        process.env.FANCHENG_DATA_DIR = path.resolve(candidate);
        return;
      }
    } catch {
      // ignore
    }
  }
})();

const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');

if (process.env.PHILOSOPHY_FILTER_V2 == null || process.env.PHILOSOPHY_FILTER_V2 === '') {
  process.env.PHILOSOPHY_FILTER_V2 = '1';
}

process.on('uncaughtException', (err) => {
  console.error('[FanchengFinance] 未捕获异常:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FanchengFinance] 未处理 Promise 拒绝:', reason);
});
const { getUserDataDir, migrateUserDataFromRoaming, getExternalRoot, getDataDir } = require('../services/data-paths');
const { version: APP_VERSION } = require('../package.json');
const { fetchAllData, fetchIndicesLive, refreshIndicesInBackground, fetchIndicesQuick, invalidateDataCache, getCachedAllData, getCachedIndices, scheduleBackgroundRefresh, refreshAllData, setDataRefreshListener, setOutlookRecomputeEnabled, setRefreshAbortCheck, abortRefreshCycle, fetchFedLive, refreshFedInBackground, patchSourceInCache } = require('../services/data-fetcher');
const config = require('../services/config');
const { warmAllCaches, getStartupSnapshot, getPushStartupPayload, prefetchAfterStartup, flushAllCaches } = require('../services/cache-store');
const { localizeErrorMessage } = require('../services/translate');
const { fetchIndexHistory, refreshIndexKline, listIndicesWithHistory } = require('../services/history-fetcher');
const { fetchCommoditiesLive, refreshCommoditiesLiveInBackground } = require('../services/commodities-fetcher');
const {
  fetchCommodityHistory,
  refreshCommodityKline,
  listCommoditiesWithHistory,
} = require('../services/commodities-history-fetcher');
const { listCommodityCatalogFlat } = require('../services/commodities-catalog');
const { fetchMacroLive } = require('../services/macro-fetcher');
const { fetchForexLive, refreshForexLiveInBackground } = require('../services/forex-fetcher');
const { fetchPolicyLive, refreshPolicyLiveInBackground } = require('../services/policy-fetcher');
const { fetchGeopoliticsLive, refreshGeopoliticsInBackground } = require('../services/geopolitics-fetcher');
const { fetchClimateLive, refreshClimateInBackground } = require('../services/climate-fetcher');
let fetchCommodityOutlookLive;
let refreshCommodityOutlookInBackground;
let refreshOutlookForPushCycle;
let invalidateOutlookDiskCache;
try {
  ({
    fetchCommodityOutlookLive,
    refreshCommodityOutlookInBackground,
    refreshOutlookForPushCycle,
    invalidateOutlookDiskCache,
  } = require('../services/commodity-outlook-engine'));
} catch (err) {
  console.error('[main] commodity-outlook-engine 加载失败，研判推送降级:', err.message);
  fetchCommodityOutlookLive = async () => ({
    categories: [],
    instruments: [],
    error: '研判模块未加载',
  });
  refreshCommodityOutlookInBackground = async () => ({
    categories: [],
    instruments: [],
  });
  refreshOutlookForPushCycle = async () => null;
  invalidateOutlookDiskCache = () => ({ ok: false });
}
const { fetchBojLive, refreshBojInBackground } = require('../services/boj-fetcher');
const {
  fetchCommodityNews,
  fetchCommodityNewsRefresh,
  fetchCommoditiesNewsOverview,
  getCachedCommodityNews,
  warmNewsCache,
  invalidateNewsCache,
} = require('../services/commodities-news');
const {
  fetchAllFlashNews,
  getFlashNewsInbox,
  getFlashNewsSummary,
  addManualFlashNews,
} = require('../services/flash-news-fetcher');

let mainWindow;
let unifiedPushTimer = null;
let pushCycleIndex = 0;
let windowInteractive = true;
let pushLoopsPaused = false;
let rendererActiveTab = 'indices';
let rendererScrolling = false;
let rendererHidden = false;
let rendererIdle = false;
let skipHeavyMainWork = false;
let mainWatchdogTimer = null;
const lastPushHashByChannel = {};
const lastPushAtByChannel = {};
const pendingPushByChannel = {};
const pushFlushTimers = {};
const MIN_PUSH_INTERVAL_MS = 8000;
const COMMODITIES_TAB_PUSH_MS = 60000;
const OUTLOOK_TAB_PUSH_MS = 45000;
let lastOutlookQuoteRefreshAt = null;

let dataQualityStatus = {
  ok: true,
  level: 'ok',
  label: '数据检测中…',
  latestCloseDate: null,
  criticalCount: 0,
  warningCount: 0,
  healing: false,
  updatedAt: null,
  checks: [],
};
let dataQualityTimer = null;
let dataQualityRunning = false;
let lastUserActivityAt = Date.now();
let pendingFullDataQuality = null;

const DAILY_BRIEF_IPC_CACHE_MS = 5 * 60 * 1000;
let dailyBriefIpcCache = { payload: null, at: 0, holdingsKey: null };
const SLOT_DECISION_IPC_CACHE_MS = 5 * 60 * 1000;
let slotDecisionIpcCache = { payload: null, at: 0, holdingsKey: null };

function touchUserActivity() {
  lastUserActivityAt = Date.now();
}

function isAfterLocal2100() {
  try {
    const cnSession = require('../services/cn-futures-session-calendar');
    const { hour } = cnSession.getCnNowParts();
    return hour >= 21;
  } catch {
    return false;
  }
}

function isUserActivelyUsingApp() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) return false;
  if (mainWindow.isFocused() || windowInteractive) return true;
  return Date.now() - lastUserActivityAt < 2 * 60 * 1000;
}

function shouldDeferFullDataQuality(trigger) {
  if (trigger === 'manual-ipc' || (typeof trigger === 'string' && trigger.startsWith('manual'))) return false;
  if (isAfterLocal2100()) return false;
  return isUserActivelyUsingApp();
}

function flushPendingFullDataQuality() {
  if (!pendingFullDataQuality || dataQualityRunning) return;
  const args = pendingFullDataQuality;
  pendingFullDataQuality = null;
  runDataQualityCycle({ ...args, force: true }).catch(() => {});
}

function buildQualityUILabel(report, healing = false) {
  const close = report?.latestCloseDate || '—';
  if (healing) return `自动修复中 · ${formatQualitySessionLabel(close)}`;
  if (report?.criticalCount > 0) return `数据异常 · ${formatQualitySessionLabel(close)}`;
  if (report?.warningCount > 0) return `数据 OK · ${formatQualitySessionLabel(close)} · ${report.warningCount} 项警告`;
  return `数据 OK · ${formatQualitySessionLabel(close)}`;
}

function formatQualitySessionLabel(closeDate) {
  if (isCnMarketHours() && lastOutlookQuoteRefreshAt) {
    try {
      const d = new Date(lastOutlookQuoteRefreshAt);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n) => String(n).padStart(2, '0');
        return `实时 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    } catch {
      // fall through
    }
  }
  return `收盘 ${closeDate}`;
}

function qualityLevelFromReport(report, healing = false) {
  if (healing) return 'critical';
  if (report?.criticalCount > 0) return 'critical';
  if (report?.warningCount > 0) return 'warning';
  return 'ok';
}

function notifyDataQualityStatus(patch = {}) {
  dataQualityStatus = { ...dataQualityStatus, ...patch, updatedAt: new Date().toISOString() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('data-quality-status', dataQualityStatus);
  }
}

async function runDataQualityCycle({ mode = 'full', trigger = 'scheduled', autoHeal = true, force = false } = {}) {
  if (mode === 'full' && !force && shouldDeferFullDataQuality(trigger)) {
    pendingFullDataQuality = { mode, trigger, autoHeal };
    console.log('[data-quality] deferring full cycle (user active):', trigger);
    return dataQualityStatus;
  }
  if (dataQualityRunning) return dataQualityStatus;
  dataQualityRunning = true;
  notifyDataQualityStatus({ healing: autoHeal && dataQualityStatus.criticalCount > 0, label: '数据检测中…' });

  try {
    const { runQualityAudit } = require('../services/data-quality-guard');
    const { runQualityHeal } = require('../services/data-quality-heal');
    let report = await runQualityAudit({
      mode,
      packagedContext: app.isPackaged,
      trigger,
    });

    if (!report.ok && autoHeal) {
      notifyDataQualityStatus({
        healing: true,
        level: 'critical',
        label: buildQualityUILabel(report, true),
        latestCloseDate: report.latestCloseDate,
        criticalCount: report.criticalCount,
        warningCount: report.warningCount,
      });
      await runQualityHeal(report, { trigger: `${trigger}-heal` });
      report = await runQualityAudit({ mode, packagedContext: app.isPackaged, trigger: `${trigger}-post-heal` });
      if (!report.ok && autoHeal) {
        await runQualityHeal(report, { trigger: `${trigger}-heal-2` });
        report = await runQualityAudit({ mode, packagedContext: app.isPackaged, trigger: `${trigger}-post-heal-2` });
      }
    }

    notifyDataQualityStatus({
      ok: report.ok,
      level: qualityLevelFromReport(report, false),
      label: buildQualityUILabel(report, false),
      latestCloseDate: report.latestCloseDate,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount || 0,
      healing: false,
      checks: (report.checks || []).map((c) => ({
        id: c.id,
        name: c.name,
        passed: c.passed,
        severity: c.severity,
      })),
    });
    return report;
  } catch (err) {
    console.warn('[data-quality] cycle failed:', err.message);
    const raw = err?.message || String(err);
    const infraErr = /ENOENT.*chdir/i.test(raw) || /chdir.*app\.asar/i.test(raw);
    const prevOk = dataQualityStatus?.ok;
    notifyDataQualityStatus({
      ok: infraErr ? true : prevOk === true,
      level: infraErr ? 'ok' : 'warning',
      label: infraErr ? `数据 OK · 收盘 ${dataQualityStatus.latestCloseDate || '—'}` : '数据检测暂时不可用，稍后自动重试',
      healing: false,
    });
    return null;
  } finally {
    dataQualityRunning = false;
  }
}

function isCnMarketHours() {
  try {
    const cnSession = require('../services/cn-futures-session-calendar');
    const { hour, minute } = cnSession.getCnNowParts();
    const nowMin = hour * 60 + minute;
    if (nowMin >= 9 * 60 && nowMin < 15 * 60) return true;
    if (nowMin >= 21 * 60 || nowMin < 2 * 60 + 30) return true;
    return false;
  } catch {
    return false;
  }
}

function startDataQualityScheduler() {
  if (dataQualityTimer) return;
  setTimeout(() => {
    runDataQualityCycle({ mode: 'full', trigger: 'startup+3min', autoHeal: true }).catch(() => {});
  }, 3 * 60 * 1000);

  dataQualityTimer = setInterval(() => {
    if (!isCnMarketHours()) return;
    runDataQualityCycle({ mode: 'light', trigger: 'market-hours-30m', autoHeal: true }).catch(() => {});
  }, 30 * 60 * 1000);
}

function stopDataQualityScheduler() {
  if (dataQualityTimer) {
    clearInterval(dataQualityTimer);
    dataQualityTimer = null;
  }
}

function startMainThreadWatchdog() {
  if (mainWatchdogTimer) return;
  setRefreshAbortCheck(() => skipHeavyMainWork);
  mainWatchdogTimer = setInterval(() => {
    const t0 = Date.now();
    setImmediate(() => {
      const lag = Date.now() - t0;
      if (lag > 100) {
        console.warn(`[main] event loop lag ${lag}ms`);
      }
      if (lag > 3000) {
        skipHeavyMainWork = true;
        abortRefreshCycle();
        setTimeout(() => {
          skipHeavyMainWork = false;
        }, 30000);
      }
    });
  }, 1500);
}

function shouldRunBackgroundRefresh() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && !pushLoopsPaused);
}

/** 全板块后台轮询顺序（应用打开时持续刷新缓存，不限于当前 Tab） */
const ALL_PUSH_STEPS = [
  'indices',
  'commodities',
  'forex',
  'policy',
  'geopolitics',
  'climate',
  'outlook',
  'centralBank',
];

const TAB_PUSH_STEPS = {
  indices: ['indices'],
  commodities: ['indices'],
  macro: ['indices'],
  forex: ['forex'],
  policy: ['policy'],
  geopolitics: ['geopolitics'],
  climate: ['climate'],
  outlook: ['commodities', 'outlook'],
  fed: ['centralBank'],
  boj: ['centralBank'],
  treasury: [],
  xinhua: [],
};

const CHANNEL_TO_TAB = {
  'indices-live': 'indices',
  'commodities-live': 'commodities',
  'forex-live': 'forex',
  'policy-live': 'policy',
  'geopolitics-live': 'geopolitics',
  'climate-live': 'climate',
  'outlook-live': 'outlook',
  'outlook-quotes-updated': 'outlook',
  'outlook-data-updated': 'outlook',
  'fed-live': 'fed',
  'boj-live': 'boj',
};

function hashLiveItemsPayload(data) {
  if (!data) return '';
  const stamp = data.liveRefreshedAt || data.updatedAt || '';
  const count = data.items?.length || data.pairs?.length || 0;
  const head = data.items?.[0]?.id || data.pairs?.[0]?.id || '';
  return `${stamp}|${count}|${head}`;
}

function hashCentralBankPayload(data) {
  if (!data) return '';
  const stamp = data.liveRefreshedAt || data.updatedAt || '';
  return `${stamp}|${data.news?.length || 0}|${data.speeches?.length || 0}|${data.indicators?.length || 0}`;
}

function hashCommoditiesPayload(data) {
  if (!data?.exchanges?.length) return '';
  const stamp = data.fetchedAt || data.liveRefreshedAt || '';
  const items = data.exchanges.flatMap((ex) => ex.items || []);
  const priceSig = items
    .filter((i) => i.price != null)
    .slice(0, 12)
    .map((i) => `${i.id}:${i.price}:${i.changePct}`)
    .join('|');
  return `${stamp}|${items.length}|${priceSig}`;
}

function hashIndicesPayload(data) {
  if (!data?.regions?.length) return '';
  const stamp = data.fetchedAt || data.liveRefreshedAt || '';
  const items = data.regions.flatMap((r) => r.indices || []);
  const priceSig = items
    .filter((i) => i.price != null)
    .slice(0, 18)
    .map((i) => `${i.id}:${i.price}:${i.changePct}`)
    .join('|');
  return `${stamp}|${items.length}|${priceSig}`;
}

function hashOutlookPayload(data) {
  if (!data?.instruments?.length && !data?.categories?.length) return '';
  const stamp = data.liveRefreshedAt || data.updatedAt || '';
  const priceSig = (data.instruments || [])
    .filter((i) => i.price != null)
    .slice(0, 16)
    .map((i) => `${i.id}:${i.price}:${i.changePct}`)
    .join('|');
  return `${stamp}|${data.instruments?.length || 0}|${priceSig}`;
}

function shouldDeliverPush(channel) {
  if (!windowInteractive || rendererHidden || rendererScrolling) return false;
  if (channel === 'indices-live') {
    return rendererActiveTab === 'indices' || (TAB_PUSH_STEPS[rendererActiveTab] || []).includes('indices');
  }
  if (channel === 'fed-live') return rendererActiveTab === 'fed';
  if (channel === 'boj-live') return rendererActiveTab === 'boj';
  const tab = CHANNEL_TO_TAB[channel];
  if (!tab) return true;
  return rendererActiveTab === tab;
}

function pushToRenderer(channel, data, hashFn) {
  if (!mainWindow || mainWindow.isDestroyed() || !data || !windowInteractive) return;
  if (!shouldDeliverPush(channel)) return;
  if (mainWindow.webContents.isLoading()) return;
  const hash = hashFn(data);
  if (!hash || lastPushHashByChannel[channel] === hash) return;

  pendingPushByChannel[channel] = { data, hash };

  const flush = () => {
    const pending = pendingPushByChannel[channel];
    if (!pending) return;
    delete pendingPushByChannel[channel];
    delete pushFlushTimers[channel];
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (lastPushHashByChannel[channel] === pending.hash) return;
    lastPushHashByChannel[channel] = pending.hash;
    lastPushAtByChannel[channel] = Date.now();
    mainWindow.webContents.send(channel, pending.data);
  };

  const now = Date.now();
  const elapsed = now - (lastPushAtByChannel[channel] || 0);
  if (elapsed >= MIN_PUSH_INTERVAL_MS && !pushFlushTimers[channel]) {
    flush();
  } else if (!pushFlushTimers[channel]) {
    pushFlushTimers[channel] = setTimeout(flush, Math.max(50, MIN_PUSH_INTERVAL_MS - elapsed));
  }
}

function bootstrapUserDataPath() {
  const externalUserData = getUserDataDir();
  if (externalUserData) {
    app.setPath('userData', externalUserData);
    migrateUserDataFromRoaming(externalUserData);
  }
}

bootstrapUserDataPath();
try {
  const dataRoot = getExternalRoot();
  const dataDir = getDataDir();
  console.log(
    `[FanchengFinance] data root: ${dataRoot || '—'} | data: ${dataDir || '—'} | FANCHENG_DATA_DIR=${process.env.FANCHENG_DATA_DIR || '—'}`
  );
} catch (err) {
  console.warn('[FanchengFinance] data path probe failed:', err.message);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

function getForexRefreshMs() {
  const seconds = config.readConfig().forexRefreshSeconds;
  const resolved = Number.isFinite(seconds) ? seconds : 15;
  return Math.max(15, Math.min(60, resolved)) * 1000;
}

function pushForexLiveToRenderer(data) {
  if (!data?.pairs?.length) return;
  pushToRenderer('forex-live', data, hashLiveItemsPayload);
}

function makePushTick(fetchFn, refreshFn, pushFn) {
  let busy = false;
  return async () => {
    if (busy) return;
    if (rendererScrolling && !shouldRunBackgroundRefresh()) return;
    if (skipHeavyMainWork && !shouldRunBackgroundRefresh()) return;
    busy = true;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      try {
        const data = await fetchFn({ force: false });
        if (hasLivePushPayload(data)) {
          pushFn(data);
          return;
        }
      } catch {
        // fall through to background refresh
      }
      const data = await refreshFn();
      if (hasLivePushPayload(data)) {
        pushFn(data);
      }
    } catch {
      // ignore
    } finally {
      busy = false;
    }
  };
}

function clearUnifiedPushTimer() {
  if (unifiedPushTimer) clearInterval(unifiedPushTimer);
  unifiedPushTimer = null;
}

function setWindowInteractive(active) {
  windowInteractive = active;
  rendererHidden = !active;
  if (active) touchUserActivity();
  else flushPendingFullDataQuality();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setBackgroundThrottling(!active);
  }
  if (active && !pushLoopsPaused) {
    runPushCycle(true);
  }
}

function scheduleDeferredFlushAllCaches() {
  setTimeout(() => {
    setImmediate(() => {
      try {
        flushAllCaches();
      } catch {
        // ignore
      }
      scheduleDeferredFlushAllCaches();
    });
  }, 10 * 60 * 1000);
}

function pausePushLoops() {
  pushLoopsPaused = true;
  clearUnifiedPushTimer();
  for (const key of Object.keys(pushFlushTimers)) {
    clearTimeout(pushFlushTimers[key]);
    delete pushFlushTimers[key];
  }
}

function resumePushLoops() {
  if (!pushLoopsPaused) return;
  pushLoopsPaused = false;
  startUnifiedPushLoop();
}

function makeCentralBankPushTick() {
  let busy = false;
  return async () => {
    if (busy || rendererScrolling) return;
    busy = true;
    try {
      if (rendererActiveTab === 'fed') {
        try {
          const fed = await fetchFedLive();
          if (hasLivePushPayload(fed)) {
            pushFedLiveToRenderer(fed);
          } else {
            refreshFedInBackground().then((data) => data && pushFedLiveToRenderer(data));
          }
        } catch {
          refreshFedInBackground().then((data) => data && pushFedLiveToRenderer(data));
        }
      } else if (rendererActiveTab === 'boj') {
        try {
          const boj = await fetchBojLive();
          if (hasLivePushPayload(boj)) {
            patchSourceInCache('boj', boj);
            pushBojLiveToRenderer(boj);
          } else {
            refreshBojInBackground().then((data) => {
              if (data) {
                patchSourceInCache('boj', data);
                pushBojLiveToRenderer(data);
              }
            });
          }
        } catch {
          refreshBojInBackground().then((data) => {
            if (data) {
              patchSourceInCache('boj', data);
              pushBojLiveToRenderer(data);
            }
          });
        }
      }
    } catch {
      // ignore
    } finally {
      busy = false;
    }
  };
}

const pushCycleSteps = [
  { name: 'indices', run: null },
  { name: 'commodities', run: null },
  { name: 'forex', run: null },
  { name: 'policy', run: null },
  { name: 'geopolitics', run: null },
  { name: 'climate', run: null },
  { name: 'outlook', run: null },
  { name: 'centralBank', run: null },
];

function initPushCycleSteps() {
  pushCycleSteps[0].run = makePushTick(
    fetchIndicesLive,
    refreshIndicesInBackground,
    pushIndicesLiveToRenderer
  );
  pushCycleSteps[1].run = makePushTick(
    fetchCommoditiesLive,
    refreshCommoditiesLiveInBackground,
    pushCommoditiesLiveToRenderer
  );
  pushCycleSteps[2].run = makePushTick(fetchForexLive, refreshForexLiveInBackground, pushForexLiveToRenderer);
  pushCycleSteps[3].run = makePushTick(fetchPolicyLive, refreshPolicyLiveInBackground, pushPolicyLiveToRenderer);
  pushCycleSteps[4].run = makePushTick(
    fetchGeopoliticsLive,
    refreshGeopoliticsInBackground,
    pushGeopoliticsLiveToRenderer
  );
  pushCycleSteps[5].run = makePushTick(fetchClimateLive, refreshClimateInBackground, pushClimateLiveToRenderer);
  // Outlook tab: lightweight price patch every tick; full recompute every 5 min in engine
  pushCycleSteps[6].run = makePushTick(
    fetchCommodityOutlookLive,
    refreshOutlookForPushCycle,
    pushOutlookLiveToRenderer
  );
  pushCycleSteps[7].run = makeCentralBankPushTick();
}

async function runPushCycle(force = false) {
  if (pushLoopsPaused || !mainWindow || mainWindow.isDestroyed()) return;
  if (!force && rendererScrolling) return;
  if (!pushCycleSteps[0].run) initPushCycleSteps();

  let stepNames;
  if (shouldRunBackgroundRefresh()) {
    stepNames = ALL_PUSH_STEPS;
  } else {
    stepNames = TAB_PUSH_STEPS[rendererActiveTab] || ['indices'];
    if (rendererActiveTab === 'commodities' && !rendererIdle) {
      stepNames = ['indices', 'commodities'];
    }
  }

  if (!stepNames.length) return;
  const stepName = stepNames[pushCycleIndex % stepNames.length];
  pushCycleIndex += 1;
  const step = pushCycleSteps.find((s) => s.name === stepName);
  if (!step?.run) return;
  try {
    await step.run();
  } catch {
    // ignore
  }
}

function startUnifiedPushLoop() {
  clearUnifiedPushTimer();
  if (pushLoopsPaused) return;
  initPushCycleSteps();
  const baseMs =
    Math.max(getForexRefreshMs(), getPolicyRefreshMs(), getCentralBankRefreshMs()) + 20000;
  const stepMs =
    rendererActiveTab === 'commodities'
      ? COMMODITIES_TAB_PUSH_MS
      : rendererActiveTab === 'outlook'
        ? OUTLOOK_TAB_PUSH_MS
        : Math.max(20000, Math.floor(baseMs / 2));
  setTimeout(() => runPushCycle(true), 5000);
  unifiedPushTimer = setInterval(() => runPushCycle(false), stepMs);
}

function startForexPushLoop() {
  startUnifiedPushLoop();
}

function startGeopoliticsPushLoop() {
  startUnifiedPushLoop();
}

function startClimatePushLoop() {
  startUnifiedPushLoop();
}

function startPolicyPushLoop() {
  startUnifiedPushLoop();
}

function startCentralBankPushLoop() {
  startUnifiedPushLoop();
}

function getPolicyRefreshMs() {
  const seconds = config.readConfig().policyRefreshSeconds;
  const resolved = Number.isFinite(seconds) ? seconds : 45;
  return Math.max(30, Math.min(300, resolved)) * 1000;
}

function pushPolicyLiveToRenderer(data) {
  if (!data?.items?.length) return;
  patchSourceInCache('policy', data);
  pushToRenderer('policy-live', data, hashLiveItemsPayload);
}

function pushGeopoliticsLiveToRenderer(data) {
  if (!data?.items?.length) return;
  patchSourceInCache('geopolitics', data);
  pushToRenderer('geopolitics-live', data, hashLiveItemsPayload);
}

function pushClimateLiveToRenderer(data) {
  if (!data?.items?.length) return;
  patchSourceInCache('climate', data);
  pushToRenderer('climate-live', data, hashLiveItemsPayload);
}

function hashOutlookQuotesPayload(data) {
  const stamp = data?.liveRefreshedAt || data?.commodities?.fetchedAt || '';
  const fg =
    data?.commodities?.exchanges
      ?.flatMap((ex) => ex.items || [])
      ?.find((i) => String(i.id).toUpperCase() === 'FG')?.price ?? '';
  const count = data?.quotedCount ?? data?.commodities?.stats?.success ?? 0;
  return `${stamp}|${count}|FG:${fg}`;
}

function pushOutlookQuotesUpdatedToRenderer(payload) {
  if (!payload?.commodities?.exchanges?.length) return;
  lastOutlookQuoteRefreshAt = payload.liveRefreshedAt || payload.commodities.fetchedAt || new Date().toISOString();
  patchSourceInCache('commodities', payload.commodities, { notifyOutlook: false });
  pushToRenderer('outlook-quotes-updated', payload, hashOutlookQuotesPayload);
  pushCommoditiesLiveToRenderer(payload.commodities);
  notifyDataQualityStatus({
    label: buildQualityUILabel(dataQualityStatus, false),
  });
}

function pushOutlookDataUpdatedToRenderer(data) {
  if (!data?.categories?.length && !data?.instruments?.length) return;
  patchSourceInCache('outlook', data);
  pushToRenderer('outlook-data-updated', data, hashOutlookPayload);
  pushOutlookLiveToRenderer(data);
}

function pushOutlookLiveToRenderer(data) {
  if (!data?.categories?.length && !data?.instruments?.length) return;
  patchSourceInCache('outlook', data);
  pushToRenderer('outlook-live', data, hashOutlookPayload);
}

function pushFocusAnalysisUpdatedToRenderer(payload) {
  if (!mainWindow || mainWindow.isDestroyed() || !payload?.symbol) return;
  if (!windowInteractive || rendererActiveTab !== 'outlook') return;
  if (mainWindow.webContents.isLoading()) return;
  mainWindow.webContents.send('focus-analysis-updated', payload);
}

function pushCommoditiesLiveToRenderer(data) {
  if (!data?.exchanges?.some((ex) => ex.items?.length)) return;
  patchSourceInCache('commodities', data);
  pushToRenderer('commodities-live', data, hashCommoditiesPayload);
}

function pushIndicesLiveToRenderer(data) {
  if (!data?.regions?.some((r) => r.indices?.length)) return;
  patchSourceInCache('indices', data);
  pushToRenderer('indices-live', data, hashIndicesPayload);
}

function getCentralBankRefreshMs() {
  const seconds = config.readConfig().policyRefreshSeconds;
  const resolved = Number.isFinite(seconds) ? seconds : 30;
  return Math.max(15, Math.min(300, resolved)) * 1000;
}

function hasCentralBankPayload(data) {
  return Boolean(data?.news?.length || data?.indicators?.length || data?.speeches?.length);
}

function hasLivePushPayload(data) {
  return Boolean(
    data?.pairs?.length ||
    data?.items?.length ||
    data?.exchanges?.some((ex) => ex.items?.length) ||
    data?.regions?.some((r) => r.indices?.length) ||
    data?.categories?.length ||
    data?.instruments?.length ||
    hasCentralBankPayload(data)
  );
}

function pushFedLiveToRenderer(data) {
  if (!hasCentralBankPayload(data)) return;
  pushToRenderer('fed-live', data, hashCentralBankPayload);
}

function pushBojLiveToRenderer(data) {
  if (!hasCentralBankPayload(data)) return;
  pushToRenderer('boj-live', data, hashCentralBankPayload);
}

function pushOutlookHeadlinesFastToRenderer() {
  try {
    const { readImpactHeadlinesFromDisk } = require('../services/focus-outlook-headlines');
    const headlines = readImpactHeadlinesFromDisk();
    console.log(
      `[FanchengFinance] impact headlines: global=${headlines.global?.items?.length ?? 0} sector=${headlines.sector?.items?.length ?? 0} feed=${headlines.feed?.items?.length ?? 0} root=${process.env.FANCHENG_DATA_DIR || '—'}`
    );
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('outlook-headlines-updated', {
      headlines,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[FanchengFinance] push outlook headlines failed:', err?.message || err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '梵澄金融',
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setBackgroundThrottling(true);

  const notifyFocus = (focused) => {
    setWindowInteractive(focused);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-focus-changed', { focused });
    }
  };
  mainWindow.on('focus', () => notifyFocus(true));
  mainWindow.on('blur', () => notifyFocus(false));
  mainWindow.on('minimize', () => {
    setWindowInteractive(false);
    flushPendingFullDataQuality();
  });
  mainWindow.on('restore', () => {
    resumePushLoops();
    notifyFocus(true);
  });
  mainWindow.on('hide', () => {
    setWindowInteractive(false);
    flushPendingFullDataQuality();
  });
  mainWindow.on('show', () => {
    resumePushLoops();
    notifyFocus(true);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    let payload = getPushStartupPayload();
    try {
      const { readImpactHeadlinesFromDisk } = require('../services/focus-outlook-headlines');
      const headlines = readImpactHeadlinesFromDisk();
      if (payload) {
        payload = { ...payload, outlookHeadlines: headlines };
      }
    } catch (err) {
      console.warn('[FanchengFinance] startup headlines attach failed:', err?.message || err);
    }
    if (payload && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('startup-data', payload);
    }
    pushOutlookHeadlinesFastToRenderer();
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[FanchengFinance] 页面加载失败:', code, desc, url);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[FanchengFinance] 渲染进程退出:', details?.reason, details?.exitCode);
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[FanchengFinance] 渲染进程无响应');
  });
  mainWindow.webContents.on('responsive', () => {
    console.log('[FanchengFinance] 渲染进程恢复响应');
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
  const startupT0 = Date.now();
  const startupMark = (phase) => console.log(`[startup] ${phase} +${Date.now() - startupT0}ms`);

  startupMark('ready');
  config.init(app.getPath('userData'));
  startupMark('config');
  // Defer startup heal off the critical path — full sync+audit blocks IPC and freezes UI.
  const STARTUP_HEAL_DELAY_MS = 90 * 1000;
  setTimeout(() => {
    try {
      const { runStartupDataHealWithAudit } = require('../services/startup-data-heal');
      runStartupDataHealWithAudit({ trigger: 'app-startup-deferred' })
        .then((result) => {
          console.log('[startup-heal]', JSON.stringify({
            ok: result.ok,
            steps: result.steps?.map((s) => s.step),
            deferred: true,
          }));
          startupMark('data-heal');
        })
        .catch((err) => {
          console.warn('[startup-heal] failed:', err.message);
        });
    } catch (err) {
      console.warn('[startup-heal] load failed:', err.message);
    }
  }, STARTUP_HEAL_DELAY_MS);
  createWindow();
  startupMark('window-created');
  setImmediate(() => {
    warmAllCaches(app.getPath('userData'));
    startupMark('caches-warmed');
    setTimeout(() => {
      try {
        const { runImpactScanCycle } = require('../services/focus-impact-scheduler');
        const { isCursorConfigured } = require('../services/cursor-llm-client');
        void runImpactScanCycle({ enrichCursor: isCursorConfigured() });
        console.log('[FanchengFinance] startup impact scan queued');
      } catch (err) {
        console.warn('[FanchengFinance] startup impact scan failed:', err.message);
      }
    }, 15000);
  });
  setTimeout(() => {
    try {
      const { bootstrapDailyOutlook } = require('../services/commodity-outlook-history');
      bootstrapDailyOutlook();
      startupMark('outlook-bootstrap');
    } catch {
      // non-fatal
    }
  }, 8000);
  setDataRefreshListener((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      setImmediate(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('data-refreshed', payload);
        }
      });
    }
  });
  startMainThreadWatchdog();
  setTimeout(() => startUnifiedPushLoop(), 15000);
  setTimeout(() => prefetchAfterStartup(), 120000);
  setTimeout(() => maybeRunDailyDataSync(), 30000);
  setTimeout(() => maybeFetchFlashNewsBackground(), 18000);
  scheduleDeferredFlushAllCaches();
  setInterval(() => maybeFetchFlashNewsBackground(), 15 * 60 * 1000);
  setTimeout(() => startOutlookSlotSchedulerMain(), 12000);
  setTimeout(() => startOutlookLiveRefreshMain(), 14000);
  setTimeout(() => startFocusNewsSchedulerMain(), 16000);
  setTimeout(() => startIntradayKlineSchedulerMain(), 15000);
  setTimeout(() => startDailyCloseSchedulerMain(), 18000);
  setTimeout(() => startDataQualityScheduler(), 20000);
  });
}

function startDailyCloseSchedulerMain() {
  try {
    const { startDailyCloseScheduler } = require('../services/daily-close-scheduler');
    startDailyCloseScheduler({
      onComplete: (result) => {
        if (mainWindow && !mainWindow.isDestroyed() && result?.ok !== false) {
          mainWindow.webContents.send('daily-close-sync-done', {
            date: result.date,
            durationMs: result.durationMs,
            fetched: result.fetched,
            skipped: result.skipped,
            failed: result.failed,
            trigger: result.trigger,
          });
        }
        if (result?.ok !== false) {
          runDataQualityCycle({ mode: 'full', trigger: 'daily-close-sync', autoHeal: true }).catch(() => {});
        }
      },
    });
    console.log('[FanchengFinance] daily close scheduler started');
  } catch (err) {
    console.warn('[FanchengFinance] daily close scheduler failed to start:', err.message);
  }
}

function startIntradayKlineSchedulerMain() {
  try {
    const { startIntradayKlineScheduler } = require('../services/intraday-kline-scheduler');
    startIntradayKlineScheduler({
      onComplete: (result) => {
        if (mainWindow && !mainWindow.isDestroyed() && result?.ok !== false) {
          mainWindow.webContents.send('intraday-kline-sync-done', {
            date: result.date,
            durationMs: result.durationMs,
            fetched: result.fetched,
            skipped: result.skipped,
            failed: result.failed,
            trigger: result.trigger,
          });
        }
      },
    });
    console.log('[FanchengFinance] intraday kline scheduler started');
  } catch (err) {
    console.warn('[FanchengFinance] intraday kline scheduler failed to start:', err.message);
  }
}

function startFocusNewsSchedulerMain() {
  try {
    const { invalidateStaleNewsCaches } = require('../services/focus-news-articles');
    const purged = invalidateStaleNewsCaches();
    if (purged.cleared) {
      console.log(`[FanchengFinance] cleared ${purged.cleared} stale focus news index caches`);
    }
    const { startFocusNewsScheduler, runFocusNewsCycle } = require('../services/focus-news-scheduler');
    startFocusNewsScheduler({
      onNewsRefreshed: () => {
        if (mainWindow && !mainWindow.isDestroyed() && rendererActiveTab === 'outlook') {
          mainWindow.webContents.send('focus-intel-updated', { at: new Date().toISOString() });
        }
      },
    });
    setTimeout(() => void runFocusNewsCycle({ force: true }), 5000);
    console.log('[FanchengFinance] focus anysearch news scheduler started (30min)');
    startImpactHeadlinesSchedulerMain();
    startThesisFetchSchedulerMain();
  } catch (err) {
    console.warn('[FanchengFinance] focus news scheduler failed:', err.message);
  }
}

function startThesisFetchSchedulerMain() {
  try {
    const { scheduleThesisFetchIfDue, FETCH_INTERVAL_MS } = require('../services/thesis-fetch-scheduler');
    const thesisRegistry = require('../services/thesis-registry');
    thesisRegistry.ensureSeedData?.();
    setTimeout(() => {
      void scheduleThesisFetchIfDue({ force: true });
    }, 22000);
    setInterval(() => {
      void scheduleThesisFetchIfDue();
    }, FETCH_INTERVAL_MS);
    console.log('[FanchengFinance] macro thesis fetch scheduler started (4h)');
  } catch (err) {
    console.warn('[FanchengFinance] thesis fetch scheduler failed:', err.message);
  }
}

function startImpactHeadlinesSchedulerMain() {
  try {
    const { startImpactHeadlinesScheduler } = require('../services/focus-impact-scheduler');
    startImpactHeadlinesScheduler({
      onHeadlinesUpdated: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('outlook-headlines-updated', payload);
        }
      },
      onImpactAlert: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('outlook-impact-alert', payload);
        }
      },
    });
    console.log('[FanchengFinance] impact headlines scheduler started (10min)');
  } catch (err) {
    console.warn('[FanchengFinance] impact headlines scheduler failed:', err.message);
  }
}

function startOutlookLiveRefreshMain() {
  try {
    const { startOutlookLiveRefresh } = require('../services/outlook-live-refresh');
    const { setOutlookBackgroundCompleteHook } = require('../services/commodity-outlook-engine');
    setOutlookBackgroundCompleteHook((payload) => {
      pushOutlookDataUpdatedToRenderer(payload);
    });
    startOutlookLiveRefresh({
      onQuotesUpdated: (payload) => {
        pushOutlookQuotesUpdatedToRenderer(payload);
        if (payload.outlook?.instruments?.length) {
          pushOutlookDataUpdatedToRenderer(payload.outlook);
        }
      },
      onOutlookUpdated: (payload) => {
        pushOutlookDataUpdatedToRenderer(payload);
      },
    });
    console.log('[FanchengFinance] outlook live refresh scheduler started');
  } catch (err) {
    console.warn('[FanchengFinance] outlook live refresh failed to start:', err.message);
  }
}

function startOutlookSlotSchedulerMain() {
  try {
    const { startOutlookSlotScheduler } = require('../services/outlook-slot-scheduler');
    startOutlookSlotScheduler({
      getInstruments: async ({ force } = {}) => {
        const sources = getCachedAllData()?.sources;
        const outlook = await fetchCommodityOutlookLive({ force: force !== false, sources });
        return outlook?.instruments || [];
      },
      onCaptured: (result) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('outlook-slot-captured', {
            slotId: result.slotId,
            sessionDate: result.sessionDate,
            predictionSlotLabel: result.slotMeta?.label,
            instrumentCount: result.instrumentCount,
          });
        }
      },
    });
  } catch (err) {
    console.warn('[FanchengFinance] outlook slot scheduler failed to start:', err.message);
  }
}

app.on('before-quit', () => {
  try {
    const { stopIntradayKlineScheduler } = require('../services/intraday-kline-scheduler');
    stopIntradayKlineScheduler();
  } catch {
    // ignore
  }
  try {
    const { stopDailyCloseScheduler } = require('../services/daily-close-scheduler');
    stopDailyCloseScheduler();
  } catch {
    // ignore
  }
  try {
    const { stopOutlookSlotScheduler } = require('../services/outlook-slot-scheduler');
    stopOutlookSlotScheduler();
  } catch {
    // ignore
  }
  try {
    stopDataQualityScheduler();
  } catch {
    // ignore
  }
  flushAllCaches();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-app-version', async () => APP_VERSION);

ipcMain.handle('get-data-quality-status', async () => dataQualityStatus);

ipcMain.handle('run-data-quality-audit', async (_event, options = {}) => {
  const report = await runDataQualityCycle({
    mode: options.mode || 'full',
    trigger: options.trigger || 'manual-ipc',
    autoHeal: options.autoHeal !== false,
  });
  return report ? { ...dataQualityStatus, report } : dataQualityStatus;
});

ipcMain.handle('get-philosophy-manifest', async () => {
  try {
    const { getPhilosophyManifest } = require('../services/fancheng-philosophy');
    return getPhilosophyManifest();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '哲学 manifest 加载失败') };
  }
});

ipcMain.handle('set-renderer-state', async (_event, state = {}) => {
  touchUserActivity();
  if (typeof state.activeTab === 'string' && TAB_PUSH_STEPS[state.activeTab]) {
    const tabChanged = rendererActiveTab !== state.activeTab;
    rendererActiveTab = state.activeTab;
    pushCycleIndex = 0;
    setOutlookRecomputeEnabled(state.activeTab === 'outlook');
    if (tabChanged && !pushLoopsPaused) startUnifiedPushLoop();
  }
  if (typeof state.scrolling === 'boolean') rendererScrolling = state.scrolling;
  if (typeof state.hidden === 'boolean') rendererHidden = state.hidden;
  if (typeof state.idle === 'boolean') rendererIdle = state.idle;
  return { ok: true };
});

ipcMain.handle('get-startup-snapshot', async () => getStartupSnapshot());

function returnStaleAllDataOrError(err, fallbackMessage = '数据获取失败') {
  const stale = getCachedAllData();
  if (stale) {
    return {
      ...stale,
      fromCache: true,
      partial: true,
      errors: [
        ...(stale.errors || []),
        { key: 'network', message: localizeErrorMessage(err?.message || '数据加载超时') },
      ],
    };
  }
  return { error: localizeErrorMessage(err?.message || fallbackMessage) };
}

ipcMain.handle('fetch-all', async (_event, options = {}) => {
  try {
    if (options.force) {
      setOutlookRecomputeEnabled(rendererActiveTab === 'outlook');
      return await Promise.race([
        refreshAllData({ notifyOutlook: rendererActiveTab === 'outlook', indicesFull: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('数据加载超时，请检查网络')), 120000)
        ),
      ]);
    }
    const cached = getCachedAllData();
    if (cached) return cached;
    if (skipHeavyMainWork) {
      const stale = getCachedAllData();
      if (stale) return stale;
    }
    return await Promise.race([
      fetchAllData({ ...options, skipBackground: true }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('数据加载超时，请检查网络')), 30000)
      ),
    ]);
  } catch (err) {
    return returnStaleAllDataOrError(err);
  }
});

ipcMain.handle('get-cached-indices', async () => getCachedIndices());

ipcMain.handle('get-config', async () => {
  const cfg = config.readConfig();
  const { getOverseasProxyConfig, maskProxyUrl } = require('../services/config');
  const proxyCfg = getOverseasProxyConfig();
  return {
    ...cfg,
    fredApiKeyConfigured: config.isFredApiKeyConfigured(),
    fredApiKeyMasked: maskKey(cfg.fredApiKey),
    stooqApiKeyConfigured: config.isStooqApiKeyConfigured(),
    stooqApiKeyMasked: maskKey(cfg.stooqApiKey),
    llmConfigured: config.isLlmConfigured(),
    llmApiKeyMasked: maskKey(cfg.llmApiKey),
    llmModel: cfg.llmModel || config.getLlmConfig().model,
    llmApiUrl: cfg.llmApiUrl || config.getLlmConfig().url,
    cursorConfigured: config.isCursorConfigured(),
    cursorApiKeyMasked: maskKey(cfg.cursorApiKey),
    cursorModel: cfg.cursorModel || config.getCursorConfig().model,
    cursorApiUrl: cfg.cursorApiUrl || config.getCursorConfig().proxyUrl,
    cursorConcurrency: (() => {
      const { getCloudConcurrencyLimit } = require('../services/cursor-llm-client');
      return getCloudConcurrencyLimit();
    })(),
    overseasProxyConfigured: proxyCfg.enabled,
    overseasProxyUrlMasked: maskProxyUrl(proxyCfg.url),
    overseasProxyEnabled: cfg.overseasProxyEnabled !== false,
  };
});

ipcMain.handle('save-config', async (_event, partial) => {
  const saved = config.writeConfig(partial);
  if (partial.forexRefreshSeconds != null || partial.policyRefreshSeconds != null) {
    startUnifiedPushLoop();
  }
  const { getOverseasProxyConfig, maskProxyUrl } = require('../services/config');
  const proxyCfg = getOverseasProxyConfig();
  return {
    ...saved,
    fredApiKeyConfigured: config.isFredApiKeyConfigured(),
    fredApiKeyMasked: maskKey(saved.fredApiKey),
    stooqApiKeyConfigured: config.isStooqApiKeyConfigured(),
    stooqApiKeyMasked: maskKey(saved.stooqApiKey),
    llmConfigured: config.isLlmConfigured(),
    llmApiKeyMasked: maskKey(saved.llmApiKey),
    llmModel: saved.llmModel || config.getLlmConfig().model,
    llmApiUrl: saved.llmApiUrl || config.getLlmConfig().url,
    cursorConfigured: config.isCursorConfigured(),
    cursorApiKeyMasked: maskKey(saved.cursorApiKey),
    cursorModel: saved.cursorModel || config.getCursorConfig().model,
    cursorApiUrl: saved.cursorApiUrl || config.getCursorConfig().proxyUrl,
    cursorConcurrency: (() => {
      const { getCloudConcurrencyLimit } = require('../services/cursor-llm-client');
      return getCloudConcurrencyLimit();
    })(),
    overseasProxyConfigured: proxyCfg.enabled,
    overseasProxyUrlMasked: maskProxyUrl(proxyCfg.url),
    overseasProxyEnabled: saved.overseasProxyEnabled !== false,
  };
});

ipcMain.handle('test-cursor-connection', async () => {
  try {
    const { isCursorConfigured, getCursorConfig } = require('../services/config');
    if (!isCursorConfigured()) {
      return { ok: false, error: '未配置 CURSOR_API_KEY' };
    }
    const key = process.env.CURSOR_API_KEY?.trim();
    const auth = Buffer.from(`${key}:`).toString('base64');
    const res = await fetch('https://api.cursor.com/v1/me', {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { ok: false, error: `Cursor API HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    const cc = getCursorConfig();
    return {
      ok: true,
      model: cc.model,
      email: data?.email || data?.userEmail || null,
      provider: 'Cursor',
    };
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || 'Cursor 连接失败') };
  }
});

ipcMain.handle('test-llm-connection', async () => {
  try {
    const { isLlmConfigured } = require('../services/config');
    if (!isLlmConfigured()) {
      return { ok: false, error: '未配置 LLM API URL 或密钥' };
    }
    const { callLlmApi } = require('../services/fancheng-ai-fusion');
    const text = await callLlmApi(
      '你是连接测试助手。只回复 OK。',
      { task: 'ping', instruction: '回复单个词 OK' }
    );
    if (!text) return { ok: false, error: 'LLM 返回空响应' };
    const cfg = config.getLlmConfig();
    return { ok: true, model: cfg.model, sample: String(text).slice(0, 80) };
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || 'LLM 连接失败') };
  }
});

ipcMain.handle('fetch-indices-quick', async (_event, options = {}) => {
  try {
    return await fetchIndicesQuick(options);
  } catch (err) {
    const stale = getCachedIndices();
    if (stale) return stale;
    return { error: localizeErrorMessage(err.message || '指数加载失败') };
  }
});

ipcMain.handle('fetch-indices-live', async () => {
  try {
    const data = await Promise.race([
      fetchIndicesLive(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('行情更新超时')), 25000)
      ),
    ]);
    if (!data?.error) pushIndicesLiveToRenderer(data);
    return data;
  } catch (err) {
    const stale = getCachedIndices();
    if (stale) return stale;
    return { error: localizeErrorMessage(err.message || '行情更新失败') };
  }
});

ipcMain.handle('refresh-index-kline', async (_event, indexId, timeframe, existingKlines) => {
  try {
    return await refreshIndexKline(indexId, timeframe, existingKlines || []);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'K线更新失败') };
  }
});

ipcMain.handle('fetch-index-history', async (_event, indexId, timeframe) => {
  try {
    return await fetchIndexHistory(indexId, timeframe || 'day');
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'K线数据获取失败') };
  }
});

ipcMain.handle('list-indices-history', async () => listIndicesWithHistory());

ipcMain.handle('fetch-commodities-live', async (_event, options = {}) => {
  try {
    const data = await withIpcTimeout(
      fetchCommoditiesLive(options),
      25000,
      '大宗商品行情更新超时'
    );
    if (!data?.error && !rendererIdle && rendererActiveTab === 'commodities') {
      pushCommoditiesLiveToRenderer(data);
    }
    return data;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '大宗商品行情更新失败') };
  }
});

ipcMain.handle('fetch-commodity-history', async (_event, commodityId, timeframe) => {
  try {
    await new Promise((resolve) => setImmediate(resolve));
    return await withIpcTimeout(
      fetchCommodityHistory(commodityId, timeframe || 'day'),
      45000,
      'K线数据加载超时'
    );
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'K线数据获取失败') };
  }
});

ipcMain.handle('refresh-commodity-kline', async (_event, commodityId, timeframe, existingKlines) => {
  try {
    await new Promise((resolve) => setImmediate(resolve));
    return await withIpcTimeout(
      refreshCommodityKline(commodityId, timeframe, existingKlines || []),
      45000,
      'K线更新超时'
    );
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'K线更新失败') };
  }
});

ipcMain.handle('list-commodities-history', async () => listCommoditiesWithHistory());

function withIpcTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

ipcMain.handle('fetch-macro-live', async () => {
  try {
    return await fetchMacroLive();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '宏观指标更新失败') };
  }
});

ipcMain.handle('fetch-geopolitics-live', async (_event, options = {}) => {
  try {
    return await withIpcTimeout(
      fetchGeopoliticsLive({ force: options.force !== false }),
      40000,
      '地缘政治更新超时'
    );
  } catch (err) {
    const cached = require('../services/geopolitics-fetcher').getCachedGeopoliticsSource();
    if (cached?.items?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '地缘政治更新失败') };
  }
});

ipcMain.handle('fetch-climate-live', async (_event, options = {}) => {
  try {
    return await withIpcTimeout(
      fetchClimateLive({ force: options.force !== false }),
      40000,
      '天气气候更新超时'
    );
  } catch (err) {
    const cached = require('../services/climate-fetcher').getCachedClimateSource();
    if (cached?.items?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '天气气候更新失败') };
  }
});

ipcMain.handle('fetch-outlook-live', async (_event, options = {}) => {
  try {
    const sources = getCachedAllData()?.sources;
    const timeoutMs = options.force === true ? 180000 : 90000;
    return await withIpcTimeout(
      fetchCommodityOutlookLive({ force: options.force === true, sources }),
      timeoutMs,
      '大宗走势研判更新超时'
    );
  } catch (err) {
    const cached = require('../services/commodity-outlook-engine').getCachedCommodityOutlookSource();
    if (cached?.instruments?.length || cached?.categories?.length) {
      return { ...cached, fromCache: true, stale: true };
    }
    return { error: localizeErrorMessage(err.message || '大宗走势研判更新失败') };
  }
});

ipcMain.handle('invalidate-outlook-cache', async () => {
  try {
    return invalidateOutlookDiskCache();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '研判缓存清除失败') };
  }
});

ipcMain.handle('fetch-policy-live', async (_event, options = {}) => {
  try {
    return await withIpcTimeout(
      fetchPolicyLive({ force: options.force !== false }),
      35000,
      '政策雷达更新超时'
    );
  } catch (err) {
    const cached = require('../services/policy-fetcher').getCachedPolicySource();
    if (cached?.items?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '政策雷达更新失败') };
  }
});

ipcMain.handle('fetch-boj-live', async () => {
  try {
    const data = await fetchBojLive();
    if (hasCentralBankPayload(data)) patchSourceInCache('boj', data);
    return data;
  } catch (err) {
    const cached = require('../services/boj-fetcher').getCachedBojSource();
    if (cached?.indicators?.length || cached?.news?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '日本央行数据更新失败') };
  }
});

ipcMain.handle('fetch-fed-live', async () => {
  try {
    return await fetchFedLive();
  } catch (err) {
    const cached = getCachedAllData()?.sources?.fed;
    if (cached?.news?.length || cached?.indicators?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '美联储数据更新失败') };
  }
});

ipcMain.handle('fetch-forex-live', async (_event, options = {}) => {
  try {
    return await withIpcTimeout(
      fetchForexLive({ force: options.force !== false }),
      12000,
      '外汇行情更新超时'
    );
  } catch (err) {
    const cached = require('../services/forex-fetcher').getCachedForexSource();
    if (cached?.pairs?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '外汇行情更新失败') };
  }
});

ipcMain.handle('get-commodity-catalog', async () => listCommodityCatalogFlat());

ipcMain.handle('fetch-commodity-news', async (_event, commodityId) => {
  try {
    return await withIpcTimeout(
      commodityId ? fetchCommodityNews(commodityId) : fetchCommoditiesNewsOverview(),
      18000,
      '资讯加载超时'
    );
  } catch (err) {
    if (commodityId) {
      const fallback = getCachedCommodityNews(commodityId);
      if (fallback) return { ...fallback, fromCache: true };
    }
    return { error: localizeErrorMessage(err.message || '关联资讯获取失败') };
  }
});

ipcMain.handle('invalidate-commodity-news-cache', async () => {
  invalidateNewsCache();
  return true;
});

ipcMain.handle('warm-commodity-news-cache', async () => {
  warmNewsCache();
  return true;
});

ipcMain.handle('refresh-commodity-news', async (_event, commodityId) => {
  try {
    return await withIpcTimeout(
      commodityId ? fetchCommodityNewsRefresh(commodityId) : fetchCommoditiesNewsOverview(),
      20000,
      '资讯刷新超时'
    );
  } catch (err) {
    if (commodityId) {
      const fallback = getCachedCommodityNews(commodityId);
      if (fallback) return { ...fallback, fromCache: true };
    }
    return { error: localizeErrorMessage(err.message || '关联资讯刷新失败') };
  }
});

ipcMain.handle('get-outlook-history', async (_event, instrumentId, days = 7) => {
  try {
    const { getOutlookHistory } = require('../services/commodity-outlook-history');
    return getOutlookHistory(instrumentId, days);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '研判存档读取失败') };
  }
});

ipcMain.handle('export-outlook-history', async (_event, instrumentId, days = 30) => {
  try {
    const { exportOutlookHistory } = require('../services/commodity-outlook-history');
    return exportOutlookHistory(instrumentId, days);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '研判存档导出失败') };
  }
});

ipcMain.handle('export-outlook-verification-all', async () => {
  try {
    const { exportOutlookVerificationAll } = require('../services/commodity-outlook-history');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    return exportOutlookVerificationAll(src?.instruments || null);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '检验复盘导出失败') };
  }
});

ipcMain.handle('export-outlook-slot-comparison-all', async (_event, options = {}) => {
  try {
    const { exportOutlookSlotComparisonAll, todayKey } = require('../services/commodity-outlook-history');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    return exportOutlookSlotComparisonAll(src?.instruments || null, {
      sessionDate: options.sessionDate || todayKey(),
    });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '三时段对照导出失败') };
  }
});

ipcMain.handle('export-outlook-slot-comparison-for-instrument', async (_event, instrumentId, options = {}) => {
  try {
    const { exportOutlookSlotComparisonForInstrument, todayKey } = require('../services/commodity-outlook-history');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    const inst = src?.instruments?.find((i) => String(i.id).toLowerCase() === String(instrumentId).toLowerCase());
    return exportOutlookSlotComparisonForInstrument(instrumentId, {
      sessionDate: options.sessionDate || todayKey(),
      instrument: inst || null,
    });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '三时段对照导出失败') };
  }
});

ipcMain.handle('show-item-in-folder', async (_event, fullPath) => {
  if (fullPath && typeof fullPath === 'string') {
    shell.showItemInFolder(fullPath);
  }
  return { ok: true };
});

ipcMain.handle('get-outlook-daily-compare', async (_event, dateA, dateB) => {
  try {
    const { getDailyCompare, dayKeyOffset, todayKey } = require('../services/commodity-outlook-history');
    const a = dateA || dayKeyOffset(-1);
    const b = dateB || todayKey();
    return getDailyCompare(a, b);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '每日对照读取失败') };
  }
});

ipcMain.handle('get-intel-center-pack', async () => {
  try {
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    if (src?.intelCenterPack) return src.intelCenterPack;
    const { buildIntelCenterPack } = require('../services/intel-orchestrator');
    return buildIntelCenterPack(src?.instruments || [], {
      asOf: new Date().toISOString().slice(0, 10),
      globalRegime: src?.globalRegime,
      persist: false,
    });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '情报中心包读取失败') };
  }
});

ipcMain.handle('get-intel-daily-diff', async () => {
  try {
    const { loadLatestDailyDiff } = require('../services/intel-daily-diff');
    const diff = loadLatestDailyDiff();
    if (diff) return diff;
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    return src?.intelCenterPack?.dailyDiff || { available: false, reason: 'no_diff' };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '情报日差读取失败') };
  }
});

ipcMain.handle('record-intel-analyst-annotation', async (_event, payload) => {
  try {
    const { recordAnnotation } = require('../services/intel-analyst-workbench');
    return recordAnnotation(payload || {});
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '标注失败') };
  }
});

ipcMain.handle('approve-intel-process-weights', async (_event, payload) => {
  try {
    const { approvePlaybookWeights } = require('../services/intel-process-learning');
    return approvePlaybookWeights(payload || {});
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '批准失败') };
  }
});

ipcMain.handle('reject-intel-process-weights', async (_event, payload) => {
  try {
    const { rejectPlaybookWeights } = require('../services/intel-process-learning');
    return rejectPlaybookWeights(payload || {});
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '驳回失败') };
  }
});

ipcMain.handle('run-intel-debt-ops', async (_event, payload = {}) => {
  try {
    const { runDebtOpsLoop } = require('../services/intel-debt-ops');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    const debtBoard = src?.intelCenterPack?.debtBoard;
    if (!debtBoard) {
      return { ok: false, error: '无债务板，请先刷新展望' };
    }
    const report = await runDebtOpsLoop({
      debtBoard,
      instruments: src?.instruments || [],
      maxItems: Math.min(8, Math.max(1, Number(payload.maxItems) || 3)),
      dryRun: Boolean(payload.dryRun),
      asOf: new Date().toISOString().slice(0, 10),
      persist: payload.persist !== false,
      filterInstrumentId: payload.instrumentId || payload.filterInstrumentId || null,
      filterDebtType: payload.debtType || payload.filterDebtType || null,
      preferMeta: Boolean(payload.preferMeta),
    });
    if (src?.intelCenterPack?.debtBoard && report && !report.dryRun) {
      src.intelCenterPack.debtBoard = {
        ...src.intelCenterPack.debtBoard,
        opsLoop: report,
        opsLast: {
          attempted: report.attempted,
          cleared: report.cleared,
          partial: report.partial,
          failed: report.failed,
          display: report.display,
          lastRunAt: report.asOf,
        },
      };
    }
    return { ok: true, report };
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '债务运维失败') };
  }
});

ipcMain.handle('ack-intel-false-quiet', async (_event, payload = {}) => {
  try {
    const { ackFalseQuietRisk } = require('../services/intel-quiet-brake-board');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    const qb = src?.intelCenterPack?.quietBrakeBoard;
    const result = ackFalseQuietRisk({
      asOf: payload.asOf || new Date().toISOString().slice(0, 10),
      reasons: payload.reasons || qb?.falseQuietReasons || [],
      resolution: payload.resolution || 'reviewed',
      note: payload.note || null,
      fingerprint: qb?.falseQuietLoop?.fingerprint || null,
    });
    if (src?.intelCenterPack?.quietBrakeBoard && result?.ok) {
      src.intelCenterPack.quietBrakeBoard = {
        ...src.intelCenterPack.quietBrakeBoard,
        falseQuietLoop: {
          ...(src.intelCenterPack.quietBrakeBoard.falseQuietLoop || {}),
          status: 'acknowledged',
          statusLabel: '已确认',
          canAck: false,
          commanderOverride: false,
          ack: result.state,
        },
      };
    }
    return result;
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '假静默确认失败') };
  }
});

ipcMain.handle('search-intel-memory', async (_event, payload = {}) => {
  try {
    const { searchIntelMemory } = require('../services/intel-memory-replay');
    const result = searchIntelMemory({
      q: payload.q || '',
      instrumentId: payload.instrumentId || null,
      claimId: payload.claimId || null,
      types: payload.types || undefined,
      limit: Math.min(40, Math.max(1, Number(payload.limit) || 12)),
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '记忆检索失败') };
  }
});

ipcMain.handle('replay-intel-memory-claim', async (_event, payload = {}) => {
  try {
    const { replayClaimTimeline } = require('../services/intel-memory-replay');
    const claimId = payload.claimId || payload.id;
    if (!claimId) return { ok: false, error: '暂无 claimId' };
    const timeline = replayClaimTimeline(claimId, payload);
    return { ok: true, timeline };
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '记忆回放失败') };
  }
});

ipcMain.handle('get-intel-interrupt-channel', async () => {
  try {
    const { getInterruptChannelState } = require('../services/intel-interrupt-channel');
    return getInterruptChannelState();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '打断通道读取失败') };
  }
});

ipcMain.handle('ack-intel-interrupt', async (_event, payload = {}) => {
  try {
    const { ackInterrupt } = require('../services/intel-interrupt-channel');
    return ackInterrupt(payload.key, { muteHours: payload.muteHours || 0 });
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '确认失败') };
  }
});

ipcMain.handle('dispatch-intel-interrupt-notifications', async (_event, notifications = []) => {
  try {
    const list = Array.isArray(notifications) ? notifications : [];
    const sentKeys = [];
    for (const n of list.slice(0, 3)) {
      if (Notification.isSupported()) {
        new Notification({
          title: n.title || '情报打断',
          body: n.body || '',
        }).show();
        if (n.key) sentKeys.push(n.key);
      }
    }
    let osMark = { marked: 0 };
    if (sentKeys.length) {
      const { markOsDelivered } = require('../services/intel-interrupt-channel');
      osMark = markOsDelivered(sentKeys);
    }
    return {
      ok: true,
      sent: sentKeys.length,
      keys: sentKeys,
      channels: sentKeys.length ? ['os'] : [],
      osMarked: osMark.marked || 0,
      note: sentKeys.length
        ? 'OS 通知已派发并记账'
        : 'Notification 不可用 · 仅 Hub/文件通道',
    };
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '通知失败') };
  }
});

ipcMain.handle('mute-intel-interrupt', async (_event, payload = {}) => {
  try {
    const { muteInterrupt } = require('../services/intel-interrupt-channel');
    return muteInterrupt(payload.key, { muteHours: payload.muteHours || 4 });
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '消音失败') };
  }
});

ipcMain.handle('get-intel-analyst-workbench', async () => {
  try {
    const { buildWorkbenchSummary, ANNOTATION_TYPES } = require('../services/intel-analyst-workbench');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    return {
      ...buildWorkbenchSummary(src?.instruments || []),
      annotationTypes: ANNOTATION_TYPES,
    };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '工作台读取失败') };
  }
});

ipcMain.handle('bootstrap-outlook-daily', async () => {
  try {
    const { bootstrapDailyOutlook } = require('../services/commodity-outlook-history');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    return bootstrapDailyOutlook(src?.instruments);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '每日研判存档初始化失败') };
  }
});

ipcMain.handle('capture-outlook-slot', async (_event, options = {}) => {
  try {
    const { runSlotCapture } = require('../services/outlook-slot-scheduler');
    const slotId = options.slot || options.slotId;
    if (!slotId) return { error: '缺少 slot 参数（pre-night / pre-day / pre-afternoon）' };
    const sources = getCachedAllData()?.sources;
    const outlook = await withIpcTimeout(
      fetchCommodityOutlookLive({ force: true, sources }),
      45000,
      '研判刷新超时'
    );
    return await runSlotCapture(slotId, {
      instruments: outlook?.instruments || [],
      force: options.force === true,
      sessionDate: options.date || options.sessionDate,
      captureDate: options.captureDate,
    });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '时段快照失败') };
  }
});

ipcMain.handle('get-outlook-slot-snapshots', async (_event, sessionDate) => {
  try {
    const { listSlotSnapshotsForSession, getLatestSlotCaptureMeta } = require('../services/outlook-slot-snapshot');
    const { todayKey } = require('../services/commodity-outlook-history');
    const day = sessionDate || todayKey();
    return {
      sessionDate: day,
      snapshots: listSlotSnapshotsForSession(day),
      latest: getLatestSlotCaptureMeta(day),
    };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '时段快照读取失败') };
  }
});

ipcMain.handle('get-chan-structure-hints', async (_event, instrumentId, refPrice, sessionDate) => {
  try {
    const chanLevels = require('../services/chan-multitf-levels');
    return chanLevels.getOutlookStructureHints(instrumentId, refPrice, sessionDate);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '缠论结构加载失败') };
  }
});

ipcMain.handle('get-outlook-slot-hit-rates', async (_event, options = {}) => {
  try {
    const { analyzeSlotHitRates } = require('../services/outlook-slot-analysis');
    return analyzeSlotHitRates(options);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '时段命中率分析失败') };
  }
});

ipcMain.handle('get-range-prediction-archive', async (_event, instrumentId, dateRange = {}) => {
  try {
    const archive = require('../services/range-prediction-archive');
    const records = archive
      .loadArchive(instrumentId, dateRange)
      .sort((a, b) => {
        const da = String(a.sessionDate || a.baselineDate || '');
        const db = String(b.sessionDate || b.baselineDate || '');
        return db.localeCompare(da);
      })
      .map((r) => archive.enrichAuditRecord(r));
    return {
      records,
      stats: archive.getComparisonStats(instrumentId, dateRange),
      path: archive.getArchivePath(instrumentId),
    };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '区间预测存档读取失败') };
  }
});

ipcMain.handle('get-direction-prediction-archive', async (_event, instrumentId, dateRange = {}) => {
  try {
    const archive = require('../services/direction-prediction-archive');
    return {
      records: archive.loadArchiveForAudit(instrumentId, dateRange),
      stats: archive.getDirectionStats(instrumentId, dateRange),
      path: archive.getArchivePath(instrumentId),
    };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '方向预测存档读取失败') };
  }
});

ipcMain.handle('run-direction-prediction-backfill', async (_event, options = {}) => {
  try {
    const { spawnSync } = require('child_process');
    const args = ['scripts/backfill-direction-prediction-archive.js'];
    if (options.ids?.length) args.push('--id', ...options.ids);
    if (options.from) args.push('--from', options.from);
    if (options.to) args.push('--to', options.to);
    const result = spawnSync(process.execPath, args, {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        FANCHENG_DATA_DRIVE: process.env.FANCHENG_DATA_DRIVE || 'F',
        FANCHENG_DATA_DIR: process.env.FANCHENG_DATA_DIR || process.env.FANCHENG_APP_ROOT || 'F:\\FanchengFinance',
        NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
      },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.status !== 0) {
      return { error: result.stderr || result.stdout || '方向存档回填失败' };
    }
    return { ok: true, output: result.stdout };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '方向存档回填失败') };
  }
});

ipcMain.handle('run-range-prediction-backfill', async (_event, options = {}) => {
  try {
    const { spawnSync } = require('child_process');
    const script = path.join(__dirname, '..', 'scripts', 'backfill-range-prediction-archive.js');
    const args = ['scripts/backfill-range-prediction-archive.js'];
    if (options.ids?.length) args.push('--id', ...options.ids);
    if (options.from) args.push('--from', options.from);
    if (options.to) args.push('--to', options.to);
    const result = spawnSync(process.execPath, args, {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        FANCHENG_DATA_DRIVE: process.env.FANCHENG_DATA_DRIVE || 'F',
        FANCHENG_DATA_DIR: process.env.FANCHENG_DATA_DIR || process.env.FANCHENG_APP_ROOT || 'F:\\FanchengFinance',
        NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
      },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout?.slice(-8000) || '',
      stderr: result.stderr?.slice(-4000) || '',
    };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '区间预测存档回填失败') };
  }
});

ipcMain.handle('run-outlook-backtest', async (event, options = {}) => {
  try {
    const backtest = require('../services/commodity-outlook-backtest');
    const win = BrowserWindow.fromWebContents(event.sender);
    const onProgress = (progress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('outlook-backtest-progress', progress);
      }
    };
    if (options.mode === 'longrun-2019') {
      const summary = await backtest.runLongrunBacktest2019({
        force: Boolean(options.force),
        onProgress,
      });
      return summary;
    }
    const summary = await backtest.runOutlookBacktest({
      days: options.days ?? 60,
      onProgress,
    });
    return summary;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '回测运行失败') };
  }
});

ipcMain.handle('get-outlook-longrun-summary', async () => {
  try {
    const { loadLongrunSummary, getBacktestProgress } = require('../services/commodity-outlook-backtest');
    return {
      summary: loadLongrunSummary(),
      progress: getBacktestProgress(),
    };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '长周期回测摘要读取失败') };
  }
});

ipcMain.handle('get-outlook-backtest-summary', async () => {
  try {
    const { loadBacktestSummary, getBacktestProgress } = require('../services/commodity-outlook-backtest');
    return {
      summary: loadBacktestSummary(),
      progress: getBacktestProgress(),
    };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '回测摘要读取失败') };
  }
});

ipcMain.handle('get-portfolio-holdings', async () => {
  try {
    const { getPortfolioHoldings, STORE_VERSION } = require('../services/portfolio-holdings-store');
    return { holdings: getPortfolioHoldings(), version: STORE_VERSION };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '持仓读取失败'), holdings: [] };
  }
});

ipcMain.handle('set-portfolio-holdings', async (_event, holdings = []) => {
  try {
    const { setPortfolioHoldings } = require('../services/portfolio-holdings-store');
    const { invalidateBriefCache } = require('../services/daily-brief-synthesis');
    const result = setPortfolioHoldings(holdings);
    invalidateBriefCache();
    dailyBriefIpcCache = { payload: null, at: 0, holdingsKey: null };
    slotDecisionIpcCache = { payload: null, at: 0, holdingsKey: null };
    return result;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '持仓保存失败'), ok: false };
  }
});

ipcMain.handle('get-daily-brief', async (_event, options = {}) => {
  try {
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const { buildDailyBrief } = require('../services/daily-brief-synthesis');
    const { getPortfolioHoldings } = require('../services/portfolio-holdings-store');
    const thesisRegistry = require('../services/thesis-registry');
    const src = getCachedCommodityOutlookSource();
    if (!src?.instruments?.length) {
      return { error: localizeErrorMessage('outlook 缓存未就绪') };
    }
    const holdings = getPortfolioHoldings();
    const holdingsKey = JSON.stringify(holdings);
    const now = Date.now();
    if (
      options.force !== true &&
      dailyBriefIpcCache.payload &&
      dailyBriefIpcCache.holdingsKey === holdingsKey &&
      now - dailyBriefIpcCache.at < DAILY_BRIEF_IPC_CACHE_MS
    ) {
      return { ...dailyBriefIpcCache.payload, ipcCached: true };
    }
    thesisRegistry.ensureSeedData?.();
    const activeTheses = thesisRegistry.getActiveTheses?.() || thesisRegistry.queryActiveTheses?.() || [];
    const result = buildDailyBrief(src, {
      holdings,
      activeTheses,
      forceRefresh: options.force === true,
    });
    const { buildDailyBriefLlmPayload } = require('../services/daily-brief-synthesis');
    const { summarizeDailyBriefWithLlm } = require('../services/fancheng-ai-fusion');
    const llmPayload = buildDailyBriefLlmPayload(result);
    const llmResult = await summarizeDailyBriefWithLlm(llmPayload);
    const enriched = llmResult
      ? {
          ...result,
          llmNarrative: llmResult.llmNarrative,
          llmMethod: llmResult.method,
          llmCitations: llmResult.citations,
          ruleBasedThreeAnswers: result.threeAnswers,
        }
      : result;
    dailyBriefIpcCache = { payload: enriched, at: now, holdingsKey };
    return enriched;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'Daily Brief 生成失败') };
  }
});

ipcMain.handle('get-slot-decision-brief', async (_event, options = {}) => {
  try {
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const { buildDailyBrief } = require('../services/daily-brief-synthesis');
    const { buildSlotDecisionBrief } = require('../services/fancheng-ai-fusion');
    const { getPortfolioHoldings } = require('../services/portfolio-holdings-store');
    const thesisRegistry = require('../services/thesis-registry');
    const src = getCachedCommodityOutlookSource();
    if (!src?.instruments?.length) {
      return { error: localizeErrorMessage('outlook 缓存未就绪') };
    }
    const holdings = getPortfolioHoldings();
    const holdingsKey = JSON.stringify(holdings);
    const now = Date.now();
    if (
      options.force !== true &&
      slotDecisionIpcCache.payload &&
      slotDecisionIpcCache.holdingsKey === holdingsKey &&
      now - slotDecisionIpcCache.at < SLOT_DECISION_IPC_CACHE_MS
    ) {
      return { ...slotDecisionIpcCache.payload, ipcCached: true };
    }
    thesisRegistry.ensureSeedData?.();
    const activeTheses = thesisRegistry.getActiveTheses?.() || thesisRegistry.queryActiveTheses?.() || [];
    const brief = buildDailyBrief(src, {
      holdings,
      activeTheses,
      forceRefresh: options.force === true,
    });
    const result = await buildSlotDecisionBrief(src, holdings, brief);
    slotDecisionIpcCache = { payload: result, at: now, holdingsKey };
    return result;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '三槽解读生成失败') };
  }
});

ipcMain.handle('get-red-team-weekly', async (_event, options = {}) => {
  try {
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const { buildRedTeamWeekly } = require('../services/red-team-weekly');
    const { getPortfolioHoldings } = require('../services/portfolio-holdings-store');
    const src = getCachedCommodityOutlookSource();
    if (!src?.instruments?.length) {
      return { error: localizeErrorMessage('outlook 缓存未就绪') };
    }
    return buildRedTeamWeekly(src, { holdings: getPortfolioHoldings(), force: options.force });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '红队周报生成失败') };
  }
});

ipcMain.handle('log-behavior-override', async (_event, entry = {}) => {
  try {
    const { logBehaviorOverride } = require('../services/behavior-override-log');
    return logBehaviorOverride(entry);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '行为覆盖记录失败'), ok: false };
  }
});

ipcMain.handle('get-behavior-override-summary', async (_event, symbol) => {
  try {
    const { summarizeOverridePatterns } = require('../services/behavior-override-log');
    return summarizeOverridePatterns(symbol || null);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '行为覆盖摘要失败') };
  }
});

ipcMain.handle('get-pre-mortem', async (_event, instrumentId, postureIntent) => {
  try {
    const { buildPreMortem } = require('../services/pre-mortem-gate');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    const id = String(instrumentId || '').toLowerCase();
    const inst = src?.instruments?.find((i) => String(i.id).toLowerCase() === id);
    if (!inst) return { error: localizeErrorMessage('品种未找到或未加载 outlook 缓存') };
    return buildPreMortem(inst, {
      postureIntent: postureIntent || '试仓',
      globalRisk: src.globalRisk || src.globalLiquidityRisk,
    });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '事前验尸生成失败') };
  }
});

ipcMain.handle('check-pre-mortem-ack', async (_event, signalId) => {
  try {
    const { hasAck, getAck } = require('../services/pre-mortem-ack-store');
    return { acknowledged: hasAck(signalId), ack: getAck(signalId) };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '验尸确认查询失败'), acknowledged: false };
  }
});

ipcMain.handle('save-pre-mortem-ack', async (_event, entry = {}) => {
  try {
    const { saveAck } = require('../services/pre-mortem-ack-store');
    return saveAck(entry);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '验尸确认保存失败'), ok: false };
  }
});

ipcMain.handle('run-margin-stress', async (_event, holdings = [], marginBumpPct = 2) => {
  try {
    const { runMarginStress } = require('../services/margin-stress-test');
    const { getPortfolioHoldings } = require('../services/portfolio-holdings-store');
    const list = holdings?.length ? holdings : getPortfolioHoldings();
    return runMarginStress(list, marginBumpPct);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '保证金压力测试失败') };
  }
});

ipcMain.handle('log-position-close', async (_event, entry = {}) => {
  try {
    const { logPositionClose } = require('../services/re-entry-cooldown-store');
    const { invalidateBriefCache } = require('../services/daily-brief-synthesis');
    const result = logPositionClose(entry);
    invalidateBriefCache();
    return result;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '平仓记录失败'), ok: false };
  }
});

ipcMain.handle('get-reentry-cooldown', async (_event, symbol) => {
  try {
    const { getReentryCooldown } = require('../services/re-entry-cooldown');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    const id = String(symbol || '').toLowerCase();
    const inst = src?.instruments?.find((i) => String(i.id).toLowerCase() === id);
    return getReentryCooldown(id, { inst });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '再入场冷却查询失败') };
  }
});

ipcMain.handle('get-core-tactical-state', async (_event, holdings = []) => {
  try {
    const { computeCoreTacticalState } = require('../services/core-tactical-slots');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const { getPortfolioHoldings } = require('../services/portfolio-holdings-store');
    const src = getCachedCommodityOutlookSource();
    const list = holdings?.length ? holdings : getPortfolioHoldings();
    return computeCoreTacticalState(list, src?.instruments || []);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '核心/快钱槽查询失败') };
  }
});

ipcMain.handle('list-pain-entries', async (_event, limit = 100) => {
  try {
    const { listPainEntries } = require('../services/pain-memory-playbook');
    return { entries: listPainEntries(limit) };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '痛苦记忆读取失败'), entries: [] };
  }
});

ipcMain.handle('add-pain-entry', async (_event, entry = {}) => {
  try {
    const { addPainEntry } = require('../services/pain-memory-playbook');
    const { invalidateBriefCache } = require('../services/daily-brief-synthesis');
    const result = addPainEntry(entry);
    if (result.ok) invalidateBriefCache();
    return result;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '痛苦记忆保存失败'), ok: false };
  }
});

ipcMain.handle('delete-pain-entry', async (_event, id) => {
  try {
    const { deletePainEntry } = require('../services/pain-memory-playbook');
    const { invalidateBriefCache } = require('../services/daily-brief-synthesis');
    const result = deletePainEntry(id);
    if (result.ok) invalidateBriefCache();
    return result;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '痛苦记忆删除失败'), ok: false };
  }
});

ipcMain.handle('get-holiday-gap-risk', async (_event, asOfDate) => {
  try {
    const { getHolidayGapRisk } = require('../services/holiday-gap-calendar');
    return getHolidayGapRisk(asOfDate || new Date());
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '假期缺口查询失败') };
  }
});

ipcMain.handle('get-macro-ai-brief', async (_event, options = {}) => {
  try {
    const { buildMacroBrief, summarizeMacroWithLlm } = require('../services/fancheng-ai-fusion');
    const { getCachedCommodityOutlookSource, fetchCommodityOutlookLive } = require('../services/commodity-outlook-engine');
    const { getCachedAllData } = require('../services/data-fetcher');
    const thesisRegistry = require('../services/thesis-registry');
    let src = getCachedCommodityOutlookSource();
    if (!src?.globalRisk && !src?.globalLiquidityRisk) {
      src = (await fetchCommodityOutlookLive({ force: false, sources: getCachedAllData()?.sources })) || src;
    }
    const globalRisk = src?.globalRisk || src?.globalLiquidityRisk;
    if (!globalRisk) {
      return { brief: null, error: localizeErrorMessage('全球风险数据暂无') };
    }
    thesisRegistry.ensureSeedData?.();
    const activeTheses =
      thesisRegistry.getActiveTheses?.() || thesisRegistry.queryActiveTheses?.() || [];
    let brief =
      src?.aiMacroBrief ||
      buildMacroBrief(globalRisk, activeTheses, src?.macroSynthesis, {
        instruments: src?.instruments || [],
        sources: {},
      });
    if (options?.augmentLlm && brief?.summary) {
      brief = await summarizeMacroWithLlm(brief, { globalRisk, activeTheses });
    }
    return { brief };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '宏观 AI 摘要生成失败') };
  }
});

ipcMain.handle('get-fancheng-ai-brief', async (_event, instrumentId) => {
  try {
    const { buildInstrumentBrief } = require('../services/fancheng-ai-fusion');
    const { getCachedCommodityOutlookSource, fetchCommodityOutlookLive } = require('../services/commodity-outlook-engine');
    const { getCachedAllData } = require('../services/data-fetcher');
    const { refreshPilotGuidance } = require('../services/global-risk-regime');
    const outlookTradingGuidance = require('../services/outlook-trading-guidance');
    let src = getCachedCommodityOutlookSource();
    if (!src?.instruments?.length) {
      src = (await fetchCommodityOutlookLive({ force: false, sources: getCachedAllData()?.sources })) || src;
    }
    const id = String(instrumentId || '').toLowerCase();
    let inst = src?.instruments?.find((i) => String(i.id).toLowerCase() === id);
    if (!inst) {
      return { error: localizeErrorMessage('品种未找到或未加载 outlook 缓存') };
    }
    const globalRisk = src?.globalRisk || src?.globalLiquidityRisk;
    if (outlookTradingGuidance.isPilotSymbol(inst.id) && !inst.tradingGuidance?.pilot) {
      inst = refreshPilotGuidance(inst, globalRisk);
    }
    const brief =
      inst.aiFusion?.instrumentBrief?.summary && inst.aiFusion.instrumentBrief.summary.indexOf('待校验') === -1
        ? inst.aiFusion.instrumentBrief
        : buildInstrumentBrief(inst, {
            globalRisk,
            macroSynthesis: src.macroSynthesis,
            sources: getCachedAllData()?.sources || {},
          });
    const { isUserFocusSymbol } = require('../services/user-focus-symbols');
    const { generateInstrumentAnalysis } = require('../services/focus-daily-analysis');
    const { isCursorConfigured } = require('../services/config');
    let cursorAnalysis = null;
    if (isUserFocusSymbol(inst.id) && isCursorConfigured()) {
      cursorAnalysis = await generateInstrumentAnalysis(inst, src, { force: false });
    }
    return {
      brief,
      aiFusion: { instrumentBrief: brief, asOf: brief.asOf },
      cursorAnalysis: cursorAnalysis?.analysis || null,
      cursorModel: cursorAnalysis?.analysis?.model || null,
    };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'AI 融合摘要生成失败') };
  }
});

ipcMain.handle('ask-fancheng-ai', async (_event, question, instrumentId) => {
  try {
    const { answerQuestionWithLlm } = require('../services/fancheng-ai-fusion');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const { evaluateNoTradeDay } = require('../services/no-trade-day');
    const { computeCoreTacticalState } = require('../services/core-tactical-slots');
    const { getPortfolioHoldings } = require('../services/portfolio-holdings-store');
    const thesisRegistry = require('../services/thesis-registry');
    const src = getCachedCommodityOutlookSource();
    const id = String(instrumentId || '').toLowerCase();
    const inst = src?.instruments?.find((i) => String(i.id).toLowerCase() === id);
    if (!inst) {
      return { error: localizeErrorMessage('品种未找到或未加载 outlook 缓存') };
    }
    thesisRegistry.ensureSeedData?.();
    const globalRisk = src.globalRisk || src.globalLiquidityRisk;
    const holdings = getPortfolioHoldings();
    const noTradeDay = evaluateNoTradeDay({
      instruments: src.instruments || [],
      globalRisk,
      holdings,
      masterClock: src.masterClock,
    });
    const coreTactical = computeCoreTacticalState(holdings, src.instruments || []);
    const context = {
      instrument: inst,
      globalRisk,
      activeTheses: thesisRegistry.getActiveTheses?.() || thesisRegistry.queryActiveTheses?.() || [],
      macroSynthesis: src.macroSynthesis,
      noTradeDay,
      coreTactical,
      holdings,
    };
    const { isUserFocusSymbol } = require('../services/user-focus-symbols');
    const { isCursorConfigured } = require('../services/config');
    if (isUserFocusSymbol(inst.id) && isCursorConfigured()) {
      const { analyzeWithCursor, ANALYSIS_SYSTEM_PROMPT } = require('../services/cursor-llm-client');
      const { buildInstrumentContext } = require('../services/focus-daily-analysis');
      const structured = buildInstrumentContext(inst, src);
      structured.question = String(question || '');
      const cursorResult = await analyzeWithCursor(
        `${ANALYSIS_SYSTEM_PROMPT}\n\n用户问题：${String(question || '')}`,
        structured
      );
      if (cursorResult.text) {
        return {
          answer: cursorResult.text,
          citations: [],
          confidence: 'medium',
          unknowns: [],
          dataSource: 'cursor-llm-client',
          method: cursorResult.method,
          provider: 'cursor',
          model: cursorResult.model,
          asOf: new Date().toISOString(),
        };
      }
    }
    return await answerQuestionWithLlm(String(question || ''), context);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'AI 问答失败') };
  }
});

ipcMain.handle('get-llm-status', async () => {
  try {
    const { isLlmConfigured, getLlmConfig } = require('../services/config');
    const configured = isLlmConfigured();
    const cfg = getLlmConfig();
    let providerHint = null;
    if (configured && cfg.url) {
      try {
        const host = new URL(cfg.url).hostname;
        if (/openai/i.test(host)) providerHint = 'OpenAI';
        else if (/anthropic/i.test(host)) providerHint = 'Anthropic';
        else if (/deepseek/i.test(host)) providerHint = 'DeepSeek';
        else providerHint = host;
      } catch {
        providerHint = null;
      }
    }
    return {
      configured,
      model: configured ? cfg.model : null,
      providerHint: configured ? providerHint : null,
      cursor: (() => {
        try {
          const { isCursorConfigured, getCursorConfig } = require('../services/config');
          const cc = getCursorConfig();
          return {
            configured: isCursorConfigured(),
            model: cc.model,
            provider: 'Cursor',
            keyMasked: cc.keyMasked,
          };
        } catch {
          return { configured: false, model: null, provider: 'Cursor' };
        }
      })(),
    };
  } catch (err) {
    return { configured: false, model: null, providerHint: null, error: err.message };
  }
});

ipcMain.handle('mark-impact-alerts-read', async (_event, options = {}) => {
  try {
    const { markImpactAlertsRead } = require('../services/focus-outlook-headlines');
    return markImpactAlertsRead(options.newsIds || []);
  } catch (err) {
    return { ok: false, error: localizeErrorMessage(err.message || '标记已读失败') };
  }
});

ipcMain.handle('get-outlook-headlines', async (_event, options = {}) => {
  try {
    const { buildOutlookHeadlinesPackage, readImpactHeadlinesFromDisk } = require('../services/focus-outlook-headlines');
    const quick =
      options.runScan === true
        ? await buildOutlookHeadlinesPackage({}, {
            skipScan: false,
            enrichCursor: false,
            forceLiquidity: false,
            fast: true,
          })
        : readImpactHeadlinesFromDisk();
    if (options.enrichCursor !== false) {
      setImmediate(() => {
        void buildOutlookHeadlinesPackage({}, {
          skipScan: true,
          enrichCursor: true,
          forceLiquidity: options.forceLiquidity === true,
        }).then((full) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('outlook-headlines-updated', {
              headlines: full,
              at: new Date().toISOString(),
            });
          }
        });
      });
    }
    return quick;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '研判头条加载失败') };
  }
});

ipcMain.handle('get-focus-dashboard', async (_event, options = {}) => {
  try {
    const diskCache = require('../services/disk-cache');
    const { getDataDir } = require('../services/data-paths');
    if (!diskCache.getRoot()) {
      const dataDir = getDataDir();
      if (dataDir) diskCache.init(dataDir);
    }
    const { getCachedCommodityOutlookSource, fetchCommodityOutlookLive } = require('../services/commodity-outlook-engine');
    const { getFocusDashboard } = require('../services/focus-daily-analysis');
    const { filterToUserFocus } = require('../services/user-focus-symbols');
    const { mergeOutlookWithSources } = require('../services/outlook-context-merge');
    const { getCachedAllData } = require('../services/data-fetcher');
    const sources = getCachedAllData()?.sources || {};
    let src = mergeOutlookWithSources(getCachedCommodityOutlookSource() || {});
    if (!src?.instruments?.length) {
      src = mergeOutlookWithSources((await fetchCommodityOutlookLive({ force: false, sources })) || src);
    }
    if (!src?.instruments?.length) {
      src = mergeOutlookWithSources((await fetchCommodityOutlookLive({ force: true, sources })) || src);
    }
    if (!src?.instruments?.length && Array.isArray(options.instruments) && options.instruments.length) {
      src = {
        instruments: options.instruments,
        globalLiquidityRisk: options.globalRisk || null,
        globalRisk: options.globalRisk || null,
        sources,
        updatedAt: new Date().toISOString(),
        dataSource: 'renderer-outlook-bridge',
      };
    }
    if (!src?.instruments?.length) {
      return { error: localizeErrorMessage('outlook 缓存未就绪') };
    }
    if (!filterToUserFocus(src.instruments).length) {
      return { error: localizeErrorMessage('关注品种池为空') };
    }
    return await getFocusDashboard(src, {
      force: options.force === true,
      generate: options.generate !== false,
      top5Deep: options.top5Deep !== false,
    });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '关注品种看板生成失败') };
  }
});

ipcMain.handle('get-news-coverage-audit', async (_event, options = {}) => {
  try {
    const diskCache = require('../services/disk-cache');
    const { getDataDir } = require('../services/data-paths');
    if (!diskCache.getRoot()) {
      const dataDir = getDataDir();
      if (dataDir) diskCache.init(dataDir);
    }
    const {
      auditNewsCoverage,
      persistCoverageAudit,
      readCachedCoverageAudit,
    } = require('../services/news-coverage-audit');
    if (options.force === true) {
      try {
        const { fetchExchangeNoticeBundle } = require('../services/exchange-notice-fetcher');
        await fetchExchangeNoticeBundle();
      } catch {
        // ignore
      }
      const live = auditNewsCoverage();
      persistCoverageAudit(live);
      return { ...live, cached: false, live: true };
    }
    const cached = readCachedCoverageAudit();
    if (cached && !cached.stale) return cached;
    try {
      const { getCachedExchangeNoticeBundle, fetchExchangeNoticeBundle } = require('../services/exchange-notice-fetcher');
      if (!getCachedExchangeNoticeBundle()?.stats?.total) {
        await fetchExchangeNoticeBundle();
      }
    } catch {
      // ignore
    }
    const live = auditNewsCoverage();
    persistCoverageAudit(live);
    return { ...live, cached: false, live: true };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '资讯覆盖审计失败') };
  }
});

ipcMain.handle('get-commodity-release-calendar', async (_event, options = {}) => {
  try {
    const diskCache = require('../services/disk-cache');
    const { getDataDir } = require('../services/data-paths');
    if (!diskCache.getRoot()) {
      const dataDir = getDataDir();
      if (dataDir) diskCache.init(dataDir);
    }
    const {
      buildReleaseCalendarWithSurprise,
      persistReleaseCalendar,
      readCachedReleaseCalendar,
    } = require('../services/commodity-release-calendar');
    const { getCachedFundamentalsSource } = require('../services/commodity-fundamentals-fetcher');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const daysAhead = Math.min(30, Math.max(7, Number(options.daysAhead) || 14));
    const fundamentals = getCachedFundamentalsSource();
    const outlook = getCachedCommodityOutlookSource() || {};
    const { collectReleaseNewsPool } = require('../services/release-data-surprise');
    const newsPool = collectReleaseNewsPool();
    if (options.force === true) {
      const live = buildReleaseCalendarWithSurprise(fundamentals, outlook, newsPool);
      persistReleaseCalendar(live);
      return { ...live, cached: false, live: true };
    }
    const cached = readCachedReleaseCalendar();
    if (cached && !cached.stale) return cached;
    const live = buildReleaseCalendarWithSurprise(fundamentals, outlook, newsPool);
    persistReleaseCalendar(live);
    return { ...live, cached: false, live: true };
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '发布日历加载失败') };
  }
});

ipcMain.handle('generate-focus-analysis', async (_event, instrumentId, options = {}) => {
  try {
    const { getCachedCommodityOutlookSource, fetchCommodityOutlookLive } = require('../services/commodity-outlook-engine');
    const { generateInstrumentAnalysis } = require('../services/focus-daily-analysis');
    const { isUserFocusSymbol } = require('../services/user-focus-symbols');
    let src = getCachedCommodityOutlookSource();
    if (!src?.instruments?.length) {
      src = (await fetchCommodityOutlookLive({ force: false })) || src;
    }
    const id = String(instrumentId || '').toLowerCase();
    if (!isUserFocusSymbol(id)) {
      return { error: localizeErrorMessage('非用户关注品种') };
    }
    const inst = src?.instruments?.find((i) => String(i.id).toLowerCase() === id);
    if (!inst) {
      return { error: localizeErrorMessage('品种未找到或未加载 outlook 缓存') };
    }
    const timeoutMs = Number(options.timeoutMs) || 180000;
    const result = await withIpcTimeout(
      generateInstrumentAnalysis(inst, src, { force: options.force === true }),
      timeoutMs,
      'Cursor 分析生成超时'
    );
    if (result && !result.error) {
      pushFocusAnalysisUpdatedToRenderer({
        symbol: id,
        result,
        generatedAt: result.generatedAt || new Date().toISOString(),
      });
    }
    return result;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '分析生成失败') };
  }
});

ipcMain.handle('generate-top5-deep-brief', async (_event, instrumentId, options = {}) => {
  try {
    const { getCachedCommodityOutlookSource, fetchCommodityOutlookLive } = require('../services/commodity-outlook-engine');
    const { generateTop5DeepBrief } = require('../services/focus-top5-deep-brief');
    const { buildTop5IntelPackage } = require('../services/focus-intelligence-brief');
    const { isUserFocusSymbol } = require('../services/user-focus-symbols');
    let src = getCachedCommodityOutlookSource();
    if (!src?.instruments?.length) {
      src = (await fetchCommodityOutlookLive({ force: false })) || src;
    }
    const id = String(instrumentId || '').toLowerCase();
    if (!isUserFocusSymbol(id)) {
      return { error: localizeErrorMessage('非用户关注品种') };
    }
    const inst = src?.instruments?.find((i) => String(i.id).toLowerCase() === id);
    if (!inst) {
      return { error: localizeErrorMessage('品种未找到或未加载 outlook 缓存') };
    }
    const intelPack = buildTop5IntelPackage(
      (src.instruments || []).filter((i) => isUserFocusSymbol(i.id)),
      src
    );
    const rankRow = intelPack.top5.find((t) => String(t.symbol).toLowerCase() === id);
    const timeoutMs = Number(options.timeoutMs) || 180000;
    const result = await withIpcTimeout(
      generateTop5DeepBrief(inst, src, { force: options.force === true, rank: rankRow?.rank }),
      timeoutMs,
      'Top5 深度解读生成超时'
    );
    if (result && !result.error) {
      pushFocusAnalysisUpdatedToRenderer({
        kind: 'top5-deep',
        symbol: id,
        result,
        generatedAt: result.generatedAt || new Date().toISOString(),
      });
    }
    return result;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'Top5 深度解读生成失败') };
  }
});

ipcMain.handle('get-focus-news-article', async (_event, symbol, newsId, options = {}) => {
  try {
    const { getFocusNewsArticle } = require('../services/focus-news-articles');
    const { getCachedCommodityOutlookSource, fetchCommodityOutlookLive } = require('../services/commodity-outlook-engine');
    const sym = String(symbol || '').toLowerCase();
    const id = String(newsId || '').trim();
    if (!id) return { error: localizeErrorMessage('参数缺失') };
    let src = getCachedCommodityOutlookSource();
    if (!src?.instruments?.length) {
      src = (await fetchCommodityOutlookLive({ force: false })) || src;
    }
    const inst =
      sym && sym !== 'global'
        ? src?.instruments?.find((i) => String(i.id).toLowerCase() === sym)
        : null;
    return await getFocusNewsArticle(sym || 'global', id, {
      inst,
      outlookPayload: src,
      previewOnly: options.previewOnly === true,
      force: options.force === true,
    });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '新闻读取失败') };
  }
});

ipcMain.handle('mark-focus-analysis-read', async (_event, instrumentId) => {
  try {
    const { markRead } = require('../services/focus-read-state');
    return markRead(instrumentId);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '标记已读失败') };
  }
});

ipcMain.handle('get-cursor-status', async () => {
  try {
    const { isCursorConfigured, getCursorConfig } = require('../services/cursor-llm-client');
    const cc = getCursorConfig();
    return {
      configured: isCursorConfigured(),
      model: cc.model,
      provider: 'Cursor',
      proxyUrl: cc.proxyUrl,
      concurrency: cc.concurrency,
      keyMasked: cc.keyMasked,
      version: cc.version,
    };
  } catch (err) {
    return { configured: false, error: err.message };
  }
});

ipcMain.handle('open-external', async (_event, url) => {
  if (url && typeof url === 'string') {
    await shell.openExternal(url);
  }
});

ipcMain.handle('show-notification', async (_event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || '梵澄金融', body: body || '' }).show();
  }
});

let flashNewsFetchPromise = null;
let lastFlashNewsFetchAt = 0;
let dailyDataSyncPromise = null;

ipcMain.handle('get-intraday-kline-sync-status', async () => {
  try {
    const { getIntradayKlineSchedulerStatus } = require('../services/intraday-kline-scheduler');
    return getIntradayKlineSchedulerStatus();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '分钟K线同步状态读取失败') };
  }
});

ipcMain.handle('run-intraday-kline-sync', async (_event, options = {}) => {
  try {
    const { runIntradayBackfill } = require('../services/intraday-kline-scheduler');
    return await withIpcTimeout(
      runIntradayBackfill({ trigger: 'manual-ipc', force: Boolean(options.force) }),
      30 * 60 * 1000,
      '分钟K线补齐超时'
    );
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '分钟K线补齐失败') };
  }
});

function maybeRunDailyDataSync() {
  try {
    const cfg = config.readConfig();
    if (cfg.dailyDataSyncEnabled === false) return null;
    const { shouldRunToday, runDailyDataSync } = require('../services/daily-data-sync');
    if (!shouldRunToday()) return null;
    if (dailyDataSyncPromise) return dailyDataSyncPromise;
    dailyDataSyncPromise = runDailyDataSync({ trigger: 'app-startup', dryRun: false })
      .then((result) => {
        if (mainWindow && !mainWindow.isDestroyed() && result?.ok) {
          mainWindow.webContents.send('daily-data-sync-done', {
            date: result.date,
            durationMs: result.durationMs,
            activeInstruments: result.activeInstruments,
          });
        }
        return result;
      })
      .catch(() => null)
      .finally(() => {
        dailyDataSyncPromise = null;
      });
    return dailyDataSyncPromise;
  } catch {
    return null;
  }
}

function maybeFetchFlashNewsBackground() {
  const cfg = config.readConfig();
  if (cfg.flashNewsAutoFetch === false) return null;
  const intervalMs = Math.max((cfg.flashNewsRefreshMinutes || 10) * 60 * 1000, 5 * 60 * 1000);
  if (Date.now() - lastFlashNewsFetchAt < intervalMs) return null;
  if (flashNewsFetchPromise) return flashNewsFetchPromise;
  flashNewsFetchPromise = fetchAllFlashNews({ appendInbox: true, respectRateLimit: true })
    .then((result) => {
      lastFlashNewsFetchAt = Date.now();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('flash-news-updated', getFlashNewsSummary());
      }
      return result;
    })
    .catch(() => null)
    .finally(() => {
      flashNewsFetchPromise = null;
    });
  return flashNewsFetchPromise;
}

ipcMain.handle('fetch-flash-news', async (_event, options = {}) => {
  try {
    const result = await withIpcTimeout(
      fetchAllFlashNews({ ...options, appendInbox: options.appendInbox !== false, respectRateLimit: true }),
      120000,
      '快讯抓取超时'
    );
    lastFlashNewsFetchAt = Date.now();
    return result;
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '快讯抓取失败') };
  }
});

ipcMain.handle('get-flash-news-inbox', async () => {
  try {
    return getFlashNewsInbox();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '读取快讯 inbox 失败') };
  }
});

ipcMain.handle('get-flash-news-summary', async () => {
  try {
    return getFlashNewsSummary();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '快讯摘要读取失败') };
  }
});

ipcMain.handle('add-manual-flash-news', async (_event, payload) => {
  try {
    const entries = payload?.entries ?? payload?.text ?? payload;
    const sourceLabel = payload?.sourceLabel || '手动粘贴';
    return addManualFlashNews(entries, { sourceLabel });
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '手动快讯写入失败') };
  }
});

function maskKey(key) {
  if (!key || key.length < 8) return '';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
