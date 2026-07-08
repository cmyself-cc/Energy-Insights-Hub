export const DATE_RANGES = {
  en: [
    { key: "last180", label: "Last 180 Days" },
    { key: "last90", label: "Last 90 Days" },
    { key: "last30", label: "Last 30 Days" },
    { key: "last7", label: "Last 7 Days" },
    { key: "yesterday", label: "Yesterday" },
    { key: "noLimit", label: "No Limit" }
  ],
  zh: [
    { key: "last180", label: "近180天" },
    { key: "last90", label: "近90天" },
    { key: "last30", label: "近30天" },
    { key: "last7", label: "近7天" },
    { key: "yesterday", label: "昨天" },
    { key: "noLimit", label: "不限" }
  ]
};

export const BUSINESS_DOMAINS = {
  en: [
    { key: "all", label: "All" },
    { key: "conventional", label: "Conventional Business" },
    { key: "conventional_mobility", label: "Conventional / Mobility" },
    { key: "conventional_lubricant", label: "Conventional / Lubricant" },
    { key: "conventional_chemicals", label: "Conventional / Chemicals" },
    { key: "energy_transition", label: "Energy Transition" },
    { key: "transition_biofuel", label: "Energy Transition / Biofuel" },
    { key: "transition_power_hydrogen", label: "Energy Transition / Power & Hydrogen" },
    { key: "transition_lng_gas", label: "Energy Transition / LNG & Gas" },
    { key: "transition_ccs", label: "Energy Transition / CCS" },
    { key: "inorganic_partnership", label: "M&A / Partnership" },
    { key: "inorganic_ma", label: "M&A / M&A" },
    { key: "inorganic_partnership_deal", label: "M&A / Strategic Partnership" }
  ],
  zh: [
    { key: "all", label: "全部" },
    { key: "conventional", label: "常规业务" },
    { key: "conventional_mobility", label: "常规业务 / 移动出行" },
    { key: "conventional_lubricant", label: "常规业务 / 润滑油" },
    { key: "conventional_chemicals", label: "常规业务 / 化工" },
    { key: "energy_transition", label: "能源转型" },
    { key: "transition_biofuel", label: "能源转型 / 生物燃料" },
    { key: "transition_power_hydrogen", label: "能源转型 / 电力/氢能" },
    { key: "transition_lng_gas", label: "能源转型 / LNG/天然气" },
    { key: "transition_ccs", label: "能源转型 / CCS" },
    { key: "inorganic_partnership", label: "收并购/合作伙伴" },
    { key: "inorganic_ma", label: "收并购/合作伙伴 / 收并购" },
    { key: "inorganic_partnership_deal", label: "收并购/合作伙伴 / 战略合作" }
  ]
};

export const ENTERPRISE_TYPES = {
  en: [
    { key: "all", label: "All" },
    { key: "soe", label: "State-owned Enterprises" },
    { key: "petrochina", label: "SOE / PetroChina" },
    { key: "sinopec", label: "SOE / Sinopec" },
    { key: "cnooc", label: "SOE / CNOOC" },
    { key: "china_energy", label: "SOE / China Energy Investment Group" },
    { key: "china_aviation_oil", label: "SOE / China Aviation Oil" },
    { key: "three_gorges", label: "SOE / Three Gorges" },
    { key: "private", label: "Private Enterprises" },
    { key: "catl", label: "Private / CATL" },
    { key: "energy_china", label: "Private / Energy China" },
    { key: "nio", label: "Private / NIO" }
  ],
  zh: [
    { key: "all", label: "全部" },
    { key: "soe", label: "国有企业" },
    { key: "petrochina", label: "国有企业 / 中石油" },
    { key: "sinopec", label: "国有企业 / 中石化" },
    { key: "cnooc", label: "国有企业 / 中海油" },
    { key: "china_energy", label: "国有企业 / 国家能源集团" },
    { key: "china_aviation_oil", label: "国有企业 / 中航油" },
    { key: "three_gorges", label: "国有企业 / 三峡" },
    { key: "private", label: "民营企业" },
    { key: "catl", label: "民营企业 / 宁德时代" },
    { key: "energy_china", label: "民营企业 / 中国能建" },
    { key: "nio", label: "民营企业 / 蔚来" }
  ]
};

export const SOURCE_TYPES = {
  en: [
    { key: "all", label: "All" },
    { key: "wechat", label: "WeChat Official Account" },
    { key: "news_portal", label: "News Portal" },
    { key: "press_release", label: "Press Release" },
    { key: "industry_media", label: "Industry Media" }
  ],
  zh: [
    { key: "all", label: "全部" },
    { key: "wechat", label: "微信公众号" },
    { key: "news_portal", label: "新闻门户" },
    { key: "press_release", label: "官方发布" },
    { key: "industry_media", label: "行业媒体" }
  ]
};

export const DEFAULT_FILTERS = {
  dateRange: "last180",
  businessDomain: "all",
  enterpriseType: "all",
  sourceType: "all",
  query: ""
};
