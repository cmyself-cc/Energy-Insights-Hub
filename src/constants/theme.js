export const COLORS = {
  primary: "#1a6b3c",
  primaryLight: "#e8f5ee",
  text: {
    primary: "#111",
    secondary: "#555",
    tertiary: "#888",
    light: "#999"
  },
  background: {
    light: "#f7f8f9",
    dark: "#0f1117",
    card: "#fff",
    cardDark: "#1c1f2b",
    // 禁用控件的填充色。字面值与 border.light 相同，但**刻意不复用**那个 token：
    // 一个是「分隔线」一个是「控件填充」，语义不同；复用会让日后调边框色的人
    // 顺手改掉所有禁用按钮的底色。
    // 配 COLORS.text.secondary 作标签：#555 on #f0f0f0 = 6.54:1（两种配色模式下同一个值，
    // 这一对与 darkMode 无关），且禁用态填充与启用态 primary(#1a6b3c) 的对比度为 5.74:1
    // （WCAG 1.4.11 非文本下限 3:1）—— 灰度/色盲下仍然分得清。
    // 禁用控件属于 WCAG 1.4.11 的 inactive 豁免，所以它与卡片的低对比
    // （浅色 1.14:1 / 深色 14.39:1）不是缺陷。
    disabled: "#f0f0f0"
  },
  border: {
    light: "#f0f0f0",
    dark: "#2a2d3a"
  },
  status: {
    success: "#1a6b3c",
    error: "#c00",
    warning: "#f5c518",
    info: "#2196f3"
  }
};

export const BREAKPOINTS = {
  mobile: "640px",
  tablet: "768px",
  desktop: "1024px",
  wide: "1280px"
};

export const SPACING = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "32px"
};

export const FONT_SIZES = {
  xs: "11px",
  sm: "12px",
  md: "13px",
  base: "14px",
  lg: "15px",
  xl: "16px",
  "2xl": "18px",
  "3xl": "20px",
  "4xl": "22px"
};

export const BORDER_RADIUS = {
  sm: "6px",
  md: "8px",
  lg: "10px",
  xl: "12px",
  "2xl": "16px",
  full: "20px"
};

export const TRANSITIONS = {
  fast: "0.15s",
  normal: "0.2s",
  slow: "0.3s"
};