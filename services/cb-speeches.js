const Parser = require('rss-parser');
const { scoreCbSpeech, isRelevantCbSpeech } = require('./cb-speech-scorer');
const { translateBojTitle, translateBojSpeaker } = require('./boj-news-translator');
const { localizeFedSpeechItem, relocalizeFedSpeeches } = require('./fed-speech-translator');
const diskCache = require('./disk-cache');

const FED_SPEECHES_URL = 'https://www.federalreserve.gov/feeds/speeches.xml';
const FED_SPEECHES_DISK_KEY = 'fed-speeches-v2.json';
const FED_SPEECHES_TTL_MS = 10 * 60 * 1000;
const RSS_TIMEOUT_MS = 12000;

const parser = new Parser({
  timeout: RSS_TIMEOUT_MS,
  headers: {
    'User-Agent': 'FanchengFinance/1.8 (Desktop App)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFedSpeechTitle(rawTitle) {
  const title = stripHtml(rawTitle);
  const parts = title.split(',');
  if (parts.length >= 2) {
    return {
      official: parts[0].trim(),
      title: parts.slice(1).join(',').trim(),
      rawTitle: title,
    };
  }
  return { official: '', title, rawTitle: title };
}

function localizeFedSpeech(item) {
  return localizeFedSpeechItem(item);
}

function localizeBojSpeech(item) {
  return {
    ...item,
    title: translateBojTitle(item.title),
    summary: item.summary ? translateBojSpeaker(item.summary).slice(0, 200) : '',
    official: item.official ? translateBojSpeaker(item.official) : item.official,
  };
}

async function fetchFedSpeechesRaw() {
  const feed = await Promise.race([
    parser.parseURL(FED_SPEECHES_URL),
    new Promise((_, reject) => setTimeout(() => reject(new Error('RSS 超时')), RSS_TIMEOUT_MS)),
  ]);

  return (feed.items || []).map((item) => {
    const parsed = parseFedSpeechTitle(item.title || '');
    return {
      official: parsed.official,
      title: parsed.title || parsed.rawTitle,
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || '',
      summary: stripHtml(item.contentSnippet || item.summary || '').slice(0, 220),
      bank: 'fed',
    };
  });
}

function extractBojSpeechesFromNews(news) {
  return (news || [])
    .filter((item) => {
      const text = `${item.title} ${item.summary || ''}`;
      return /speech|remarks|opening remarks|testimony|economic activity|monetary policy|讲话|演讲|致辞|货币政策|物价|汇率/i.test(
        text
      );
    })
    .map((item) => ({
      official: stripHtml(item.summary || '').replace(/,\s*Member.*/i, '').replace(/,\s*Deputy.*/i, '').trim(),
      title: item.title,
      link: item.link || '',
      pubDate: item.pubDate || '',
      summary: '',
      bank: 'boj',
    }));
}

function finalizeSpeeches(items, bank) {
  const seen = new Set();
  const scored = [];

  for (const raw of items) {
    if (!isRelevantCbSpeech(raw, bank)) continue;
    const scoredItem = scoreCbSpeech(raw, bank);
    const localized = bank === 'boj' ? localizeBojSpeech(scoredItem) : localizeFedSpeech(scoredItem);
    const key = `${localized.pubDate}|${localized.link || localized.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({
      ...localized,
      stars: scoredItem.stars,
      topicLabel: scoredItem.topicLabel,
      topics: scoredItem.topics,
      impactHint: scoredItem.impactHint,
      officialDisplay: scoredItem.officialDisplay,
    });
  }

  return scored
    .sort((a, b) => {
      const starDiff = b.stars - a.stars;
      if (starDiff) return starDiff;
      return (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0);
    })
    .slice(0, 12);
}

async function fetchFedSpeeches() {
  try {
    const raw = await fetchFedSpeechesRaw();
    const speeches = finalizeSpeeches(raw, 'fed');
    if (speeches.length) {
      diskCache.write(FED_SPEECHES_DISK_KEY, { data: speeches, savedAt: Date.now() });
    }
    return speeches;
  } catch (err) {
    const cached = diskCache.read(FED_SPEECHES_DISK_KEY, FED_SPEECHES_TTL_MS);
    if (cached?.data?.length) return cached.data;
    throw err;
  }
}

function getCachedFedSpeeches() {
  const cached = diskCache.read(FED_SPEECHES_DISK_KEY, FED_SPEECHES_TTL_MS);
  if (cached?.data?.length) return relocalizeFedSpeeches(cached.data);
  const stale = diskCache.readStale(FED_SPEECHES_DISK_KEY);
  return relocalizeFedSpeeches(stale?.data || []);
}

function extractBojSpeeches(news) {
  return finalizeSpeeches(extractBojSpeechesFromNews(news), 'boj');
}

module.exports = {
  fetchFedSpeeches,
  getCachedFedSpeeches,
  extractBojSpeeches,
  fetchFedSpeechesRaw,
};
