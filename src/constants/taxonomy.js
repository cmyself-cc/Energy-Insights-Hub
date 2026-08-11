export const DATE_RANGES = {
  en: [
    { key: "last7", label: "Last 7 Days" },
    { key: "last30", label: "Last 30 Days" },
    { key: "last90", label: "Last 90 Days" },
    { key: "noLimit", label: "No Limit" }
  ],
  zh: [
    { key: "last7", label: "近7天" },
    { key: "last30", label: "近30天" },
    { key: "last90", label: "近90天" },
    { key: "noLimit", label: "不限" }
  ]
};

export const PURPOSE_OPTIONS = {
  en: [
    { key: "competitor", label: "Competitor" },
    { key: "policy", label: "Policy" },
    { key: "tech", label: "Tech" },
    { key: "industry", label: "Industry Trends" }
  ],
  zh: [
    { key: "competitor", label: "竞争" },
    { key: "policy", label: "政策" },
    { key: "tech", label: "技术" },
    { key: "industry", label: "行业" }
  ]
};

export const BUSINESS_CATEGORIES = {
  en: [
    { key: "all", label: "All" },
    { key: "电力&氢能", label: "Power & Hydrogen" },
    { key: "储能", label: "Energy Storage" },
    { key: "光伏", label: "Solar" },
    { key: "油气", label: "Oil & Gas" },
    { key: "CCS", label: "CCS" },
    { key: "化工", label: "Chemicals" },
    { key: "LNG/天然气", label: "LNG / Gas" },
    { key: "移动出行", label: "Mobility" },
    { key: "润滑油", label: "Lubricants" },
    { key: "生物燃料", label: "Biofuels" }
  ],
  zh: [
    { key: "all", label: "全部" },
    { key: "电力&氢能", label: "电力&氢能" },
    { key: "储能", label: "储能" },
    { key: "光伏", label: "光伏" },
    { key: "油气", label: "油气" },
    { key: "CCS", label: "CCS" },
    { key: "化工", label: "化工" },
    { key: "LNG/天然气", label: "LNG/天然气" },
    { key: "移动出行", label: "移动出行" },
    { key: "润滑油", label: "润滑油" },
    { key: "生物燃料", label: "生物燃料" }
  ]
};

export const SUBJECT_CATEGORIES = {
  en: [
    { key: "all", label: "All" },
    { key: "中央部委", label: "Central Ministries" },
    { key: "地方政府", label: "Local Government" },
    { key: "国有企业", label: "State-Owned Enterprise" },
    { key: "外国公司", label: "Foreign Company" },
    { key: "私营企业", label: "Private Company" },
    { key: "研究机构", label: "Research Institution" }
  ],
  zh: [
    { key: "all", label: "全部" },
    { key: "中央部委", label: "中央部委" },
    { key: "地方政府", label: "地方政府" },
    { key: "国有企业", label: "国有企业" },
    { key: "外国公司", label: "外国公司" },
    { key: "私营企业", label: "私营企业" },
    { key: "研究机构", label: "研究机构" }
  ]
};

export const SOURCE_TYPES = {
  en: [
    { key: "all", label: "All" },
    { key: "新闻门户 / News Portal", label: "News Portal" },
    { key: "微信公众号 / WeChat Official Account", label: "WeChat Official Account" }
  ],
  zh: [
    { key: "all", label: "全部" },
    { key: "新闻门户 / News Portal", label: "新闻门户" },
    { key: "微信公众号 / WeChat Official Account", label: "微信公众号" }
  ]
};

export const DEFAULT_FILTERS = {
  dateRange: "last30",
  purposes: ["competitor"],
  businessCategory: "all",
  subjectCategory: "all",
  sourceType: "all",
  query: ""
};
