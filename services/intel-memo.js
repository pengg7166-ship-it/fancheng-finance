/**
 * 情报中心 · 最小可发布备忘录
 */
const { buildUnknownMap } = require('./intel-unknown-map');

const MEMO_VERSION = 'v2.89.4-retrieval';

function buildIntelMemo(inst, claim, clock, pricingState, scenarioLattice, gates, choiceSet) {
  if (!claim) {
    return {
      version: MEMO_VERSION,
      available: false,
      reason: 'no_claim',
      headline: '不可判定',
      dataSource: 'intel-memo',
    };
  }

  const support = (claim.evidenceFor || []).slice(0, 3).map((e) => ({
    summary: e.summary,
    dataSource: e.dataSource,
    n: e.nDisplay,
  }));
  const oppose = (claim.evidenceAgainst || []).slice(0, 1).map((e) => ({
    summary: e.summary,
    dataSource: e.dataSource,
  }));
  if (!oppose.length && inst?.intelligenceKernel?.dissent?.opposingEvidence?.length) {
    oppose.push({
      summary: inst.intelligenceKernel.dissent.opposingEvidence[0],
      dataSource: 'intelligence-kernel',
    });
  }

  const triggers = (claim.triggers || []).slice(0, 2).map((t) => t.condition);
  const unknownMap = buildUnknownMap(inst, claim);
  const primaryChoice = choiceSet?.primary || scenarioLattice?.actionSet?.primary;
  const action = primaryChoice
    ? {
        id: primaryChoice.id,
        label: primaryChoice.label,
        condition: (primaryChoice.enterWhen || []).slice(0, 2).join('；') || primaryChoice.why || '—',
        why: primaryChoice.why,
        stance: primaryChoice.stance,
      }
    : { id: 'C', label: '观望', condition: '—' };

  const headline = claim.statement;
  const gatePass = gates?.memo?.pass;
  const falsifyLine =
    claim.status === 'falsified'
      ? `已证伪 · ${claim.falsifyTrigger || '—'}`
      : claim.status === 'falsifying'
        ? `证伪进行中 · ${claim.falsifyTrigger || clock?.evaluation?.display || '—'}`
        : claim.status === 'expired'
          ? `已过期 · ${claim.validUntil || '—'}`
          : null;

  return {
    version: MEMO_VERSION,
    available: true,
    claimId: claim.claimId,
    issueId: claim.issueId || null,
    headline,
    oneLiner: falsifyLine
      ? `${claim.confidence} · ${falsifyLine}`
      : `${claim.confidence} · ${pricingState?.stateLabel || '待校验'} · ${clock?.display || '—'}`,
    claimStatus: claim.status,
    falsifyTrigger: claim.falsifyTrigger || null,
    falsifyTags: claim.falsifyTags || [],
    support,
    oppose,
    pricingState: pricingState?.stateLabel || '待校验',
    triggers,
    validUntil: claim.validUntil,
    unknownMap,
    suggestedAction: action,
    choiceSet: choiceSet
      ? {
          primaryId: choiceSet.primaryId,
          display: choiceSet.display,
          options: choiceSet.options,
          note: choiceSet.note,
          nDisplay: choiceSet.nDisplay,
          missingTriggers: choiceSet.missingTriggers,
        }
      : null,
    publishable: gatePass === true,
    gateProfile: gates?.memo || null,
    mechanismChain: claim.mechanismChain || claim.mechanism || null,
    mechanismLinks: claim.mechanismLinks || null,
    mechanismDepth: claim.mechanismDepth ?? null,
    mechanismDepthDisplay: claim.mechanismDepthDisplay || (claim.mechanismDepth != null ? String(claim.mechanismDepth) : '暂无'),
    parentClaim: claim.parentClaim || null,
    childClaims: claim.childClaims || [],
    n: claim.nDisplay,
    playbookId: claim.playbookId || null,
    regimePlaybookId: claim.regimePlaybookId || null,
    whatChanged:
      claim.whatChanged ||
      (claim.playbookTransition?.kind === 'regime_flip'
        ? `${claim.playbookTransition.fromRegime}→${claim.playbookTransition.toRegime}`
        : null),
    playbookTransition: claim.playbookTransition || null,
    playbookInjectedAgainst: Boolean(claim.playbookInjectedAgainst),
    dataSource: 'intel-memo',
    method: 'minimum-publishable-unit',
  };
}

module.exports = {
  MEMO_VERSION,
  buildIntelMemo,
  buildUnknownMap,
};
