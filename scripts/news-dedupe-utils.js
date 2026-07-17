/**
 * Shared news dedupe helpers — no circular deps with merge-flash / merge-all.
 */

function normalizeTitleKey(title) {
  return String(title)
    .toLowerCase()
    .replace(/["""''\s,，。、；;:：!?！？（）()【】\[\]-]/g, '')
    .replace(/fomc|美联储/g, 'fed');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function titleSimilarity(a, b) {
  const na = normalizeTitleKey(a);
  const nb = normalizeTitleKey(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

function mergeTags(a, b) {
  const set = new Set([...(a || '').split(';'), ...(b || '').split(';')].filter(Boolean));
  return [...set].join(';');
}

function pickRicher(existing, incoming) {
  const notes =
    [existing.notes, incoming.notes].filter(Boolean).join('；') ||
    existing.notes ||
    incoming.notes;
  const auAnchor = /【用户AU锚点/.test(incoming.notes || '');
  return {
    ...existing,
    title: auAnchor && incoming.title ? incoming.title : existing.title,
    direction: auAnchor && incoming.direction ? incoming.direction : existing.direction,
    commodity_tags: mergeTags(existing.commodity_tags, incoming.commodity_tags),
    stars: String(Math.max(parseInt(existing.stars, 10) || 3, parseInt(incoming.stars, 10) || 3)),
    notes: notes.length > 400 ? notes.slice(0, 397) + '…' : notes,
    event_id: existing.event_id || incoming.event_id,
  };
}

function dedupeSimilar(rows) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const kept = [];
  let removed = 0;
  const removedLog = [];

  for (const row of sorted) {
    const dupIdx = kept.findIndex(
      (k) =>
        k.date === row.date &&
        (k.title === row.title || titleSimilarity(k.title, row.title) >= 0.82)
    );
    if (dupIdx >= 0) {
      if (row.date === '2026-05-22' && /沁源/.test(row.title + kept[dupIdx].title)) {
        kept[dupIdx] = pickRicher(kept[dupIdx], {
          ...row,
          title: '山西沁源煤矿特大事故及调查升级',
          commodity_tags: mergeTags(kept[dupIdx].commodity_tags, row.commodity_tags),
          notes: [kept[dupIdx].notes, row.notes].filter(Boolean).join('；'),
        });
        removed += 1;
        removedLog.push({ date: row.date, title: row.title, reason: 'merged 沁源 batch5/6' });
        continue;
      }
      kept[dupIdx] = pickRicher(kept[dupIdx], row);
      removed += 1;
      removedLog.push({ date: row.date, title: row.title, reason: `similar to "${kept[dupIdx].title}"` });
      continue;
    }
    const qinIdx = kept.findIndex(
      (k) => k.date === row.date && /沁源/.test(k.title) && /沁源/.test(row.title)
    );
    if (qinIdx >= 0) {
      kept[qinIdx] = {
        ...pickRicher(kept[qinIdx], row),
        title: '山西沁源煤矿特大事故及调查升级',
        commodity_tags: mergeTags(kept[qinIdx].commodity_tags, row.commodity_tags),
        notes: [...new Set([kept[qinIdx].notes, row.notes].filter(Boolean).join('；').split('；'))].join('；'),
      };
      removed += 1;
      removedLog.push({ date: row.date, title: row.title, reason: 'merged 沁源 same-date' });
      continue;
    }
    kept.push(row);
  }

  const filtered = kept.filter(
    (r) => !(r.date === '2025-07-15' && r.title.includes('反内卷'))
  );
  if (filtered.length < kept.length) {
    removed += kept.length - filtered.length;
    removedLog.push({ date: '2025-07-15', title: '反内卷政策预期', reason: 'dup of 2025-07-01' });
  }

  return { rows: filtered, removed, removedLog };
}

module.exports = {
  normalizeTitleKey,
  levenshtein,
  titleSimilarity,
  mergeTags,
  pickRicher,
  dedupeSimilar,
};
