/**
 * 地缘分析输出 — 结构化深度分析（替代冗长段落）
 */
const { buildGeopoliticsAnalysis, buildGeopoliticsCommentaryText } = require('./geopolitics-analyst');

function buildGeopoliticsCommentary(item) {
  if (!item?.needsCommentary && !item?.needsAnalysis) return null;
  const analysis = buildGeopoliticsAnalysis(item);
  return analysis;
}

module.exports = {
  buildGeopoliticsCommentary,
  buildGeopoliticsCommentaryText,
};
