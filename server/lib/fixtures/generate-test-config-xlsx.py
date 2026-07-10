import pandas as pd
from pathlib import Path

out = Path(__file__).with_name("test-config.xlsx")

# Each sheet keeps one header row because configParser skips the first row.
keywords = pd.DataFrame({"关键词": ["培训班", "总裁班", "公开课"]})
composite = pd.DataFrame({
    "基础词": ["中石油", "中石化"],
    "_": ["", ""],
    "__": ["", ""],
    "___": ["", ""],
    "必须同时包含": ["开业", ""],
    "排除词": ["指数", "售楼"],
})
semantic = pd.DataFrame({"语义过滤规则": ["排除会议资讯"]})
categories = pd.DataFrame({
    "分类": ["移动出行"],
    "描述": ["移动出行相关业务"],
    "纳入提示": ["prompt"],
})
sources = pd.DataFrame({
    "媒体": ["微信公众号"],
    "名称": ["嘉实多"],
    "ID": ["castrolchina"],
    "网址": [""],
})

with pd.ExcelWriter(out, engine="openpyxl") as writer:
    keywords.to_excel(writer, sheet_name="关键词过滤", index=False)
    composite.to_excel(writer, sheet_name="底层过滤关键词", index=False)
    semantic.to_excel(writer, sheet_name="语义过滤", index=False)
    categories.to_excel(writer, sheet_name="业务分类描述", index=False)
    sources.to_excel(writer, sheet_name="新增微信公众号", index=False)

print(f"Generated {out}")
