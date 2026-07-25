import db from "../db.js";

export function loadSemanticWeights() {
  const rows = db.prepare("SELECT term, action, score FROM feedback_semantic_weights").all();
  const boost = [];
  const suppress = [];
  for (const row of rows) {
    const entry = { term: row.term, score: row.score };
    if (row.action === "boost") boost.push(entry);
    else suppress.push(entry);
  }
  return { boost, suppress };
}

function normalizeText(item) {
  const parts = [
    item.title || "",
    item.summary || "",
    ...(Array.isArray(item.keywords) ? item.keywords : [])
  ];
  return parts.join(" ").toLowerCase();
}

function scoreItem(item, weights) {
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

export function applyUserFeedbackScore(items, options = {}) {
  const weights = options.weights || loadSemanticWeights();
  const suppressThreshold = options.suppressThreshold ?? 2;
  const boostThreshold = options.boostThreshold ?? 2;

  const kept = [];
  const dropped = [];
  const scores = [];

  for (const item of items) {
    const { boostScore, suppressScore } = scoreItem(item, weights);
    scores.push({ title: item.title, boostScore, suppressScore });

    if (suppressScore >= suppressThreshold) {
      dropped.push({ ...item, feedbackReason: "suppress_match", boostScore, suppressScore });
      continue;
    }
    kept.push({ ...item, boostScore, suppressScore, boosted: boostScore >= boostThreshold });
  }

  return { kept, dropped, scores };
}
