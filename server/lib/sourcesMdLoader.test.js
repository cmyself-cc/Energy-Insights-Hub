import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./sourcesMdLoader.js";

const sample = `
## 官方网站/定向网站（可直接抓取）
- https://www.iea.org - 国际能源署
- https://oilprice.com - OilPrice

## 微信公众号（需人工监测/参考标题）
- 光伏们
- 高工锂电
`;

describe("parseMarkdown", () => {
  it("parses website and wechat sources", () => {
    const sources = parseMarkdown(sample);
    expect(sources.length).toBe(4);
    expect(sources[0]).toEqual({
      name: "国际能源署",
      url: "https://www.iea.org",
      type: "website",
      active: 1,
      config: JSON.stringify({})
    });
    expect(sources[2]).toEqual({
      name: "光伏们",
      url: "",
      type: "wechat",
      active: 1,
      config: JSON.stringify({ accountName: "光伏们" })
    });
  });
});
