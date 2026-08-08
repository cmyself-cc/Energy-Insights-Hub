const STORAGE_KEYS = {
  API_CONFIG: "energy_insights_api_config",
  SEARCH_CONFIG: "energy_insights_search_config",
  BOOKMARKS: "energy_insights_bookmarks",
  CART: "energy_insights_cart",
  DARK_MODE: "energy_insights_dark_mode",
  LANGUAGE: "energy_insights_language"
};

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

  getLanguage: () => {
    try {
      const language = localStorage.getItem(STORAGE_KEYS.LANGUAGE);
      return language || "en";
    } catch (error) {
      console.error("Failed to load language:", error);
      return "en";
    }
  },

  // 未保存过语言时返回 null，由调用方决定默认值（移动端默认中文）
  getStoredLanguage: () => {
    try {
      return localStorage.getItem(STORAGE_KEYS.LANGUAGE);
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
