import { useState, useEffect } from "react";

export default function Toast({ message, type = "success", duration = 3000, onClose }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onClose(), 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const styles = {
    success: {
      background: "#e8f5ee",
      border: "1px solid #1a6b3c",
      color: "#1a6b3c",
      icon: "✓"
    },
    error: {
      background: "#fff0f0",
      border: "1px solid #fcc",
      color: "#c00",
      icon: "✗"
    },
    info: {
      background: "#e3f2fd",
      border: "1px solid #2196f3",
      color: "#1976d2",
      icon: "ℹ"
    }
  };

  const style = styles[type] || styles.info;

  return (
    <div style={{
      position: "fixed",
      top: "20px",
      right: "20px",
      zIndex: 2000,
      padding: "12px 20px",
      borderRadius: 8,
      background: style.background,
      border: style.border,
      color: style.color,
      fontSize: 14,
      fontWeight: 500,
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      display: "flex",
      alignItems: "center",
      gap: 8,
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(-20px)",
      transition: "all 0.3s ease"
    }}>
      <span style={{ fontSize: 16 }}>{style.icon}</span>
      <span>{message}</span>
    </div>
  );
}

export const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div style={{ position: "fixed", top: 0, right: 0, zIndex: 2000 }}>
      {toasts.map(toast => (
        <div key={toast.id} style={{ marginTop: "10px", marginRight: "20px" }}>
          <Toast
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        </div>
      ))}
    </div>
  );
};