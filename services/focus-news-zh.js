/**
 * 资讯中文化 · 置顶/头条/文章共用（避免 focus-news-articles ↔ focus-impact-pins 循环依赖）
 */
const { translateRegulatoryTitleLocal, isAcceptableChinese } = require('./policy-en-zh-dict');

function isSyntheticNewsText(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^(美联储|美国机构|财政部|SEC|CFTC|OFAC|USTR)[：:]\s*[\u4e00-\u9fff]{2,12}$/.test(t)) return true;
  if (/^(美联储|美国机构).{0,8}(政策公告|公告)$/.test(t)) return true;
  if (/^.+：.{0,24}（关联[^）]{4,}）\s*$/.test(t)) return true;
  if (t.length < 90 && /（关联[^）]+）/.test(t) && !/[。；！?]/.test(t)) return true;
  return false;
}

function isMostlyEnglishText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (t.match(/[a-zA-Z]/g) || []).length;
  return latin > 40 && cjk < Math.max(12, latin * 0.15);
}

function polishNewsTitle(raw) {
  const titleEn = String(raw.titleEn || '').trim();
  let title = String(raw.displayTitle || raw.title || titleEn || '').trim();
  if (!title) return '无标题';
  const synthetic = isSyntheticNewsText(title);
  if (titleEn) {
    if (synthetic || !isAcceptableChinese(title) || isMostlyEnglishText(title)) {
      const local = translateRegulatoryTitleLocal(titleEn);
      if (isAcceptableChinese(local) && local.length > 8) title = local;
    }
  }
  const docLabel = raw.documentTypeLabel || '';
  if (docLabel && title && !title.startsWith('[')) title = `[${docLabel}] ${title}`;
  return title;
}

function polishNewsSummary(raw) {
  const zh = String(raw.summary || raw.snippet || raw.intro || '').trim();
  if (zh && !isSyntheticNewsText(zh) && isAcceptableChinese(zh)) return zh.slice(0, 600);
  const en = String(raw.summaryEn || raw.abstract || raw.titleEn || '').trim();
  if (!en) return '';
  if (en.length > 20) {
    const local = translateRegulatoryTitleLocal(en);
    if (isAcceptableChinese(local) && !isSyntheticNewsText(local) && local.length > 12) {
      return local.slice(0, 600);
    }
  }
  const local = translateRegulatoryTitleLocal(en);
  if (isAcceptableChinese(local) && !isSyntheticNewsText(local)) return local.slice(0, 600);
  if (en.length >= 40 && isMostlyEnglishText(en)) return en.slice(0, 600);
  return '';
}

function polishNewsFields(raw = {}) {
  const title = polishNewsTitle(raw);
  const summary = polishNewsSummary({ ...raw, title }) || String(raw.summary || '').slice(0, 600);
  return {
    title,
    summary,
    summaryIsEnglish: summary && isMostlyEnglishText(summary),
  };
}

module.exports = {
  isSyntheticNewsText,
  isMostlyEnglishText,
  polishNewsTitle,
  polishNewsSummary,
  polishNewsFields,
};
