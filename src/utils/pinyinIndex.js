import { pinyin } from "pinyin-pro";

/**
 * 返回关键词首字符的分组字母：中文 → 拼音首字母；英文 → 首字母大写；其他 → '#'。
 */
export function getInitial(name) {
  const s = String(name || "").trim();
  if (!s) return "#";
  const first = s[0];
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
  if (/[\u4e00-\u9fa5]/.test(first)) {
    const py = pinyin(first, { pattern: "first", toneType: "none" });
    return py ? py[0].toUpperCase() : "#";
  }
  return "#";
}

/**
 * 返回关键词的拼音首字母序列（大写）：中文逐字取拼音首字母；英文保留原字母；
 * 非字母数字字符跳过。用于"输入 FB 命中 发布"的首字母搜索。
 */
export function initialsSequence(name) {
  const s = String(name || "");
  let out = "";
  for (const ch of s) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      out += ch.toUpperCase();
    } else if (/[\u4e00-\u9fa5]/.test(ch)) {
      const py = pinyin(ch, { pattern: "first", toneType: "none" });
      if (py) out += py[0].toUpperCase();
    }
  }
  return out;
}
