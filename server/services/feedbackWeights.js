import db from "../db.js";

export const PURPOSES = ["competitor", "policy", "tech", "industry"];

export function loadSemanticWeights() {
  const rows = db.prepare("SELECT term, action, purpose, score FROM feedback_semantic_weights").all();
  const byPurpose = {};
  for (const p of PURPOSES) byPurpose[p] = { boost: [], suppress: [] };
  const global = { boost: [], suppress: [] };
  for (const row of rows) {
    const entry = { term: row.term, score: row.score };
    const target = row.purpose && byPurpose[row.purpose] ? byPurpose[row.purpose] : global;
    if (row.action === "boost") target.boost.push(entry);
    else target.suppress.push(entry);
  }
  return { byPurpose, global };
}

function normalizeText(item) {
  const parts = [
    item.title || "",
    item.summary || "",
    ...(Array.isArray(item.keywords) ? item.keywords : [])
  ];
  return parts.join(" ").toLowerCase();
}

function scoreAgainst(item, weights) {
  const text = normalizeText(item);
  let boostScore = 0;
  let suppressScore = 0;
  for (const { term, score } of weights.boost) {
    if (text.includes(term.toLowerCase())) boostScore += score;
  }
  for (const { term, score } of weights.suppress) {
    if (text.includes(term.toLowerCase())) suppressScore += score;
  }
  return { boostScore, suppressScore };
}

/**
 * 对候选按"其监控类别对应的 purpose 权重 + 全局权重"打分。
 * suppress 分达到阈值 → 丢弃（用户反复把这类内容从该 purpose 归走/隐藏）；
 * boost 分达到阈值 → 保留并标记 boosted。
 *
 * 兼容旧结构：options.weights 传 { boost, suppress }（无 byPurpose）时按全局打分。
 */
export function applyUserFeedbackScore(items, options = {}) {
  const weights = options.weights || loadSemanticWeights();
  const suppressThreshold = options.suppressThreshold ?? 2;
  const boostThreshold = options.boostThreshold ?? 2;

  const legacy = Array.isArray(weights.boost) || Array.isArray(weights.suppress);

  const kept = [];
  const dropped = [];
  const scores = [];

  for (const item of items) {
    const purpose = Array.isArray(item.matchedPurposes) && item.matchedPurposes.length > 0
      ? item.matchedPurposes[0]
      : "";
    const purposeWeights = !legacy && weights.byPurpose && weights.byPurpose[purpose]
      ? weights.byPurpose[purpose]
      : { boost: [], suppress: [] };
    const globalWeights = legacy ? { boost: weights.boost || [], suppress: weights.suppress || [] } : weights.global;

    const pScore = scoreAgainst(item, purposeWeights);
    const gScore = scoreAgainst(item, globalWeights);
    const boostScore = pScore.boostScore + gScore.boostScore;
    const suppressScore = pScore.suppressScore + gScore.suppressScore;

    scores.push({ title: item.title, purpose, boostScore, suppressScore });

    if (suppressScore >= suppressThreshold) {
      dropped.push({ ...item, feedbackReason: "suppress_match", boostScore, suppressScore, purpose });
      continue;
    }
    kept.push({ ...item, boostScore, suppressScore, boosted: boostScore >= boostThreshold, purpose });
  }

  return { kept, dropped, scores };
}
