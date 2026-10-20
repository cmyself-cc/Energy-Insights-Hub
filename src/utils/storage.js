import { i18n } from "../constants/i18n";

const STORAGE_KEYS = {
  API_CONFIG: "energy_insights_api_config",
  SEARCH_CONFIG: "energy_insights_search_config",
  BOOKMARKS: "energy_insights_bookmarks",
  CART: "energy_insights_cart",
  DARK_MODE: "energy_insights_dark_mode",
  LANGUAGE: "energy_insights_language"
};

// 支持的语言 = i18n 的顶层键（今天是 ['en','zh']）。从 i18n 派生而不是在这里抄一份清单：
// 抄的话，日后加语言时会**静默地**把新语言当成「不认识的值」丢掉，用户存了却读不回来。
// i18n.js 零 import，storage.js 此前也零 import，所以这条依赖不成环。
const SUPPORTED_LANGUAGES = Object.keys(i18n);

export const storage = {
  getApiConfigs: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.API_CONFIG);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      console.error("Failed to load API configs:", error);
      return [];
    }
  },

  getApiConfig: () => {
    const configs = storage.getApiConfigs();
    return configs.length > 0 ? configs[0] : null;
  },

  saveApiConfig: (config) => {
    try {
      const configs = storage.getApiConfigs();
      const id = `${config.providerName || "model"}-${Date.now()}`;
      configs.unshift({ ...config, id });
      localStorage.setItem(STORAGE_KEYS.API_CONFIG, JSON.stringify(configs));
      return true;
    } catch (error) {
      console.error("Failed to save API config:", error);
      return false;
    }
  },

  switchApiConfig: (id) => {
    try {
      const configs = storage.getApiConfigs();
      const idx = configs.findIndex(c => c.id === id);
      if (idx < 0) return null;
      const config = configs.splice(idx, 1)[0];
      configs.unshift(config);
      localStorage.setItem(STORAGE_KEYS.API_CONFIG, JSON.stringify(configs));
      return config;
    } catch (e) { return null; }
  },

  getBookmarks: () => {
    try {
      const bookmarks = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
      return bookmarks ? JSON.parse(bookmarks) : [];
    } catch (error) {
      console.error("Failed to load bookmarks:", error);
      return [];
    }
  },

  saveBookmarks: (bookmarks) => {
    try {
      localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bookmarks));
      return true;
    } catch (error) {
      console.error("Failed to save bookmarks:", error);
      return false;
    }
  },

  getCart: () => {
    try {
      const cart = localStorage.getItem(STORAGE_KEYS.CART);
      return cart ? JSON.parse(cart) : [];
    } catch (error) {
      console.error("Failed to load cart:", error);
      return [];
    }
  },

  saveCart: (cart) => {
    try {
      localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cart));
      return true;
    } catch (error) {
      console.error("Failed to save cart:", error);
      return false;
    }
  },

  getDarkMode: () => {
    try {
      const darkMode = localStorage.getItem(STORAGE_KEYS.DARK_MODE);
      return darkMode === "true";
    } catch (error) {
      console.error("Failed to load dark mode:", error);
      return false;
    }
  },

  saveDarkMode: (darkMode) => {
    try {
      localStorage.setItem(STORAGE_KEYS.DARK_MODE, darkMode.toString());
      return true;
    } catch (error) {
      console.error("Failed to save dark mode:", error);
      return false;
    }
  },

  getSearchConfig: () => {
    try {
      const config = localStorage.getItem(STORAGE_KEYS.SEARCH_CONFIG);
      return config ? JSON.parse(config) : null;
    } catch (error) {
      console.error("Failed to load search config:", error);
      return null;
    }
  },

  saveSearchConfig: (config) => {
    try {
      localStorage.setItem(STORAGE_KEYS.SEARCH_CONFIG, JSON.stringify(config));
      return true;
    } catch (error) {
      console.error("Failed to save search config:", error);
      return false;
    }
  },

  // ⚠️ 这个函数**不做**值域校验，返回的可能是 localStorage 里的任意字符串。它唯一的调用方
  // 是 App.jsx 里那句 `storage.getLanguage() === "zh" ? 中文 : 英文`（后端连不上时的错误文案），
  // 垃圾值只会让它落到英文那一边，不会崩。要拿语言去索引 i18n 的话请用下面的
  // getStoredLanguage() —— 那个才校验值域。
  getLanguage: () => {
    try {
      const language = localStorage.getItem(STORAGE_KEYS.LANGUAGE);
      return language || "en";
    } catch (error) {
      console.error("Failed to load language:", error);
      return "en";
    }
  },

  // 未保存过语言时返回 null，由调用方决定默认值（移动端默认中文）。
  //
  // ⚠️ 契约是「**受支持的语言，或 null**」，绝不能把 localStorage 里的原始字符串直接吐出去。
  // 两个调用方（App.jsx 的 effect、LoginGate.jsx 的 useState 初始化器）都写成
  // `savedLanguage || "en"`，而 "klingon" 这种非空垃圾值是**真值**，`|| "en"` 不会触发 →
  // language = "klingon" → `i18n[language]` 是 undefined → Header.jsx 的
  // `i18n[language].auth` 抛 TypeError → 整个 App 进 ErrorBoundary。而语言切换按钮自己就在
  // 崩溃的那棵树里，**用户没有办法用 UI 自救**，只能去清 localStorage。
  // 在唯一的读取口校验值域，比在每个消费点补 `|| i18n.en` 靠得住：消费点会随组件数量增长
  // （仓里一度同时存在两种写法），而这个函数只有一个。
  // 用户名+邀请码的本地记忆（产品负责人 2026-10-21）：登录成功后写入，登录门优先
  // 静默免登；用户点「清除」或静默失败时清掉。仅存本机 localStorage。
  getPairLogin: () => {
    try {
      const raw = localStorage.getItem("energy_insights_pair_login");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && parsed.username && parsed.code ? parsed : null;
    } catch {
      return null;
    }
  },
  setPairLogin: (username, code) => {
    try {
      localStorage.setItem("energy_insights_pair_login", JSON.stringify({ username: String(username), code: String(code) }));
    } catch { /* 本地存储不可用时静默降级为每次手输 */ }
  },
  clearPairLogin: () => {
    try { localStorage.removeItem("energy_insights_pair_login"); } catch { /* 同上 */ }
  },

  getStoredLanguage: () => {
    try {
      const language = localStorage.getItem(STORAGE_KEYS.LANGUAGE);
      // includes(null) 为假，所以「从没存过」自然落到 null 分支，不需要单独判空。
      return SUPPORTED_LANGUAGES.includes(language) ? language : null;
    } catch (error) {
      console.error("Failed to load language:", error);
      return null;
    }
  },

  saveLanguage: (language) => {
    try {
      localStorage.setItem(STORAGE_KEYS.LANGUAGE, language);
      return true;
    } catch (error) {
      console.error("Failed to save language:", error);
      return false;
    }
  },

  clearAll: () => {
    try {
      Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
      });
      return true;
    } catch (error) {
      console.error("Failed to clear storage:", error);
      return false;
    }
  }
};
