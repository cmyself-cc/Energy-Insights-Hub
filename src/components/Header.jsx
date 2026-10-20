import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";
import TrackerProgress from "./TrackerProgress";
import ReportProgress from "./ReportProgress";

export default function Header({ darkMode, language, onLanguageToggle, isMobile = false, activeTab, onTabChange, user, onLogout }) {
  const [currentModel, setCurrentModel] = useState(null);
  const zh = language === "zh";
  const auth = i18n[language].auth;
  // 移动端顶部导航：右上角下划线式切换（绿色粗线为选中态），与页面内 tab 区分
  const navTabStyle = (active) => ({
    padding: "8px 2px",
    border: "none",
    borderBottom: active ? `3px solid ${COLORS.primary}` : "3px solid transparent",
    background: "transparent",
    color: active ? COLORS.primary : (darkMode ? "#e8e8e8" : COLORS.text.primary),
    fontSize: FONT_SIZES.sm,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap"
  });

  // 🔴 admin-only 消费者。server/apiRoutes.js 把 /api/tracker 与 /api/models **整个前缀**
  // 挂成 requireAdmin（含 GET），而 Header 对每个已登录用户都渲染：普通用户挂上
  // <TrackerProgress> 就会被它按固定间隔轮询的 /api/tracker/status 打成连续 403（实测 ~10s 内 5 次），
  // getCurrentModel() 同理。症状不只是生产日志噪音——进度气泡永远不出现，模型芯片对所有普通
  // 用户恒显示「No model」，而它的 tooltip 还指向普通用户根本进不去的配置页。
  // 授权矩阵是 Task 6 评审通过的，本轮不动它；由前端只对 admin 挂载这两个消费者。
  // <ReportProgress> 不在此列：它打的 /api/reports/jobs 对所有已登录用户开放（实测 200）。
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    const load = () => {
      backendApi.getCurrentModel()
        .then(res => setCurrentModel(res.data || null))
        .catch(() => {});
    };
    load();
    window.addEventListener("model-updated", load);
    return () => window.removeEventListener("model-updated", load);
  }, [isAdmin]);

  // 头像兜底链：昵称首字母（大写）→ "U"。微信昵称可能是 emoji，charAt(0) 取到的是
  // 代理对的前半，渲染出来是乱码方块——所以只在首字符是字母/数字/CJK 时才用它。
  const nickname = user?.nickname || "";
  const avatarChar = /^[A-Za-z0-9\u4e00-\u9fa5]/.test(nickname) ? nickname.charAt(0).toUpperCase() : "U";

  return (
    <header style={{ position: "sticky", top: 0, zIndex: 100, minHeight: 56, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: isMobile ? 6 : 0, padding: isMobile ? "8px 16px" : "0 28px", background: darkMode ? COLORS.background.cardDark : COLORS.background.card, borderBottom: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 16, minWidth: 0, flexShrink: isMobile ? 0 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: FONT_SIZES.lg, color: darkMode ? "#fff" : COLORS.text.primary, minWidth: 0, flexShrink: isMobile ? 0 : 1 }}>
          <img src="/logo.jpg" alt="logo" style={{ width: isMobile ? 22 : 26, height: isMobile ? 22 : 26, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
          <span style={{ fontSize: isMobile ? FONT_SIZES.base : FONT_SIZES.xl, fontWeight: 700, whiteSpace: "nowrap" }}>混沌能源智库</span>
          {!isMobile && <span style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : "#999", fontWeight: 500, marginLeft: 4 }}>｜Energy Insights Hub</span>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: isMobile ? "wrap" : "nowrap", justifyContent: isMobile ? "flex-end" : "flex-start" }}>
        {/* 移动端顶部导航置于右上角：市场洞察 / 报告（侧边栏已隐藏，配置仅 Web 端可用） */}
        {isMobile && onTabChange && (
          <nav style={{ display: "flex", gap: 14 }}>
            <button style={navTabStyle(activeTab === "intelligence")} onClick={() => onTabChange("intelligence")}>{zh ? "市场洞察" : "Intelligence"}</button>
            <button style={navTabStyle(activeTab === "reports")} onClick={() => onTabChange("reports")}>{zh ? "报告" : "Reports"}</button>
          </nav>
        )}
        {/* 进度气泡：移动端悬浮在 header 上（不挤占"市场洞察/报告"导航），Web 端内联。
            Tracker 气泡只给 admin —— 理由见上面 isAdmin 处的注释。 */}
        {isAdmin && <TrackerProgress darkMode={darkMode} language={language} floating={isMobile} />}
        <ReportProgress darkMode={darkMode} language={language} />
        {/* 当前生效模型（只读展示，配置在设置页全局配置）；移动端隐藏以节省空间。
            同样只给 admin：/api/models/* 整前缀 requireAdmin，且「去设置页管理」对普通用户是死链。 */}
        {!isMobile && isAdmin && (
          <div
            title={zh ? "当前生效模型（在设置页全局配置中管理）" : "Active model (manage in Settings → Global Config)"}
            style={{
              padding: "6px 12px", borderRadius: BORDER_RADIUS.md,
              border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
              background: currentModel ? COLORS.primaryLight : "transparent",
              color: currentModel ? COLORS.primary : (darkMode ? "#888" : "#999"),
              fontSize: FONT_SIZES.sm, fontWeight: 500,
              maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}
          >
            {currentModel ? (currentModel.name || currentModel.modelId) : (zh ? "未配置模型" : "No model")}
          </div>
        )}

        {/* 移动端仅中文界面，不显示语言切换 */}
        {!isMobile && (
          <button onClick={onLanguageToggle} style={{ padding: "6px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, background: "transparent", color: darkMode ? "#e8e8e8" : COLORS.text.secondary, fontSize: FONT_SIZES.md, cursor: "pointer", fontWeight: 500, transition: `all ${TRANSITIONS.fast}` }}>
            {language === "en" ? "中 文" : "English"}
          </button>
        )}
        {/* 身份块。头像与登出**不受 isMobile 约束**：移动端没有侧边栏、也没有配置页，
            如果连登出也按 isMobile 藏掉，手机上就再也没有退出登录的入口了。
            移动端只收紧尺寸、并隐藏昵称与管理员徽标（这两项是信息，不是操作）。 */}
        {user && (
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 12 }}>
            {!isMobile && (
              <>
                <span
                  title={nickname}
                  style={{
                    maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontSize: FONT_SIZES.md, fontWeight: 500, color: darkMode ? "#e8e8e8" : COLORS.text.secondary
                  }}
                >
                  {nickname}
                </span>
                {user.role === "admin" && (
                  <span style={{
                    padding: "3px 8px", borderRadius: BORDER_RADIUS.sm,
                    background: COLORS.primaryLight, color: COLORS.primary,
                    fontSize: FONT_SIZES.xs, fontWeight: 700, whiteSpace: "nowrap"
                  }}>
                    {auth.adminBadge}
                  </span>
                )}
              </>
            )}
            {/* 微信头像优先；没有头像（dev-login / 资料接口降级）才回落到首字母圆标 */}
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                title={nickname}
                referrerPolicy="no-referrer"
                style={{
                  width: isMobile ? 26 : 30, height: isMobile ? 26 : 30, borderRadius: "50%",
                  objectFit: "cover", flexShrink: 0,
                  border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`
                }}
              />
            ) : (
              <div
                title={nickname || auth.logout}
                style={{
                  width: isMobile ? 26 : 30, height: isMobile ? 26 : 30, borderRadius: "50%",
                  background: COLORS.primaryLight, color: COLORS.primary,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: isMobile ? FONT_SIZES.sm : FONT_SIZES.md, fontWeight: 700,
                  border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                  flexShrink: 0
                }}
              >
                {avatarChar}
              </div>
            )}
            <button
              onClick={onLogout}
              title={auth.logout}
              aria-label={auth.logout}
              style={{
                padding: isMobile ? "5px 8px" : "6px 12px",
                borderRadius: BORDER_RADIUS.md,
                border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                background: "transparent",
                // 用 secondary(#555) 而不是 tertiary(#888)：#888 在白底上只有 3.54:1，低于 WCAG AA
                // 的 4.5:1，而且比紧挨着的语言切换按钮（它用的就是 secondary）还浅——同一个 header
                // 里两个同级按钮不该有两种对比度。暗色下沿用 #e8e8e8，与语言切换按钮一致。
                color: darkMode ? "#e8e8e8" : COLORS.text.secondary,
                fontSize: isMobile ? FONT_SIZES.sm : FONT_SIZES.md,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
                transition: `all ${TRANSITIONS.fast}`
              }}
            >
              {auth.logout}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
