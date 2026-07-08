import { Component } from "react";
import { COLORS } from "../constants/theme";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          background: "#f7f8f9",
          fontFamily: "Inter, system-ui, sans-serif"
        }}>
          <div style={{
            background: "#fff",
            borderRadius: "16px",
            padding: "40px",
            maxWidth: "500px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)"
          }}>
            <div style={{ fontSize: "64px", marginBottom: "16px" }}>😵</div>
            <h2 style={{
              color: COLORS.primary,
              fontSize: "24px",
              fontWeight: 700,
              marginBottom: "12px"
            }}>
              出错了
            </h2>
            <p style={{
              color: "#666",
              fontSize: "14px",
              lineHeight: 1.6,
              marginBottom: "24px"
            }}>
              应用遇到了意外错误。请尝试刷新页面。
            </p>
            {this.state.error && (
              <div style={{
                background: "#fff0f0",
                border: "1px solid #fcc",
                borderRadius: "8px",
                padding: "12px",
                marginBottom: "24px",
                textAlign: "left",
                fontSize: "12px",
                color: "#c00",
                fontFamily: "monospace",
                overflow: "auto",
                maxHeight: "150px"
              }}>
                {this.state.error.toString()}
              </div>
            )}
            <button
              onClick={this.handleReset}
              style={{
                padding: "12px 24px",
                borderRadius: "8px",
                border: "none",
                background: COLORS.primary,
                color: "#fff",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
