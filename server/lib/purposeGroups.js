/**
 * 按源的监控目的（purpose）把候选文章分组。
 *
 * 分组依据是源对象（通过 item.sourceId 从 sourceById 反查）的 purpose，
 * 而不是 item.source —— crawler 会把 item.source 覆盖成公众号名/源名等
 * 展示字符串，其上没有 purpose 属性，会导致所有源的文章都掉进 __none__ 组。
 *
 * purpose 为空的源归入 "__none__" 组（兼容旧行为：用全部规则 gate）。
 */
export function buildPurposeGroups(items, sourceById) {
  const groups = new Map();
  for (const item of items) {
    const src = sourceById.get(item.sourceId);
    const purposes = (src?.purpose || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const key = purposes.sort().join(",") || "__none__";
    if (!groups.has(key)) {
      groups.set(key, { purposes, items: [] });
    }
    groups.get(key).items.push(item);
  }
  return groups;
}
