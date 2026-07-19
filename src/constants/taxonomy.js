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
    { key: "tech", label: "Tech" }
  ],
  zh: [
    { key: "competitor", label: "竞争监控" },
    { key: "policy", label: "政策监控" },
    { key: "tech", label: "技术突破" }
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

export const EVENT_CATEGORIES = {
  en: [
    { key: "all", label: "All" },
    { key: "战略合作", label: "Strategic Partnership" },
    { key: "收并购", label: "M&A" },
    { key: "项目", label: "Project" }
  ],
  zh: [
    { key: "all", label: "全部" },
    { key: "战略合作", label: "战略合作" },
    { key: "收并购", label: "收并购" },
    { key: "项目", label: "项目" }
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
  purposes: [],
  businessCategory: "all",
  eventCategory: "all",
  sourceType: "all",
  query: ""
};
