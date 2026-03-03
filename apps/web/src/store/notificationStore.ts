// Minimal notification store for EIOS — no cloud auth, no UI notifications library needed.
// Logs to console; replace with a toast library if needed.

interface Notification {
  type: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
}

const addNotification = (n: Notification) => {
  const emoji = n.type === "success" ? "✓" : n.type === "error" ? "✗" : "i";
  console[n.type === "error" ? "error" : "info"](`[${emoji}] ${n.title}${n.message ? `: ${n.message}` : ""}`);
};

export const useNotificationStore = () => ({ addNotification });
