import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

type ToastType = "success" | "error";

type ToastItem = {
    id: number;
    message: string;
    type: ToastType;
};

type AlertItem = {
    id: number;
    title: string;
    body: string;
};

type ToastContextValue = {
    showToast: (message: string, type?: ToastType) => void;
    showCalendarAlert: (title: string, body: string) => void;
};

const ToastContext = createContext<ToastContextValue>({
    showToast: () => {},
    showCalendarAlert: () => {},
});

export function useToast() {
    return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [alerts, setAlerts] = useState<AlertItem[]>([]);

    const showToast = useCallback((message: string, type: ToastType = "success") => {
        const id = Date.now();
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3000);
    }, []);

    const showCalendarAlert = useCallback((title: string, body: string) => {
        const id = Date.now();
        setAlerts((prev) => [...prev, { id, title, body }]);
        setTimeout(() => {
            setAlerts((prev) => prev.filter((a) => a.id !== id));
        }, 6000);
    }, []);

    return (
        <ToastContext.Provider value={{ showToast, showCalendarAlert }}>
            {children}

            {/* 일반 토스트 — 상단 우측 */}
            <div style={{
                position: "fixed",
                top: 24,
                right: 24,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                zIndex: 9999,
                pointerEvents: "none",
            }}>
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        style={{
                            padding: "11px 18px",
                            background: t.type === "error" ? "#e03e3e" : "var(--color-text)",
                            color: "#fff",
                            borderRadius: 8,
                            fontSize: 13.5,
                            boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
                            whiteSpace: "nowrap",
                            animation: "toast-in 0.18s ease",
                        }}
                    >
                        {t.message}
                    </div>
                ))}
            </div>

            {/* 캘린더 알림 — 상단 중앙, 더 크고 눈에 띄게 */}
            <div style={{
                position: "fixed",
                top: 24,
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                zIndex: 10000,
                pointerEvents: "none",
            }}>
                {alerts.map((a) => (
                    <div
                        key={a.id}
                        style={{
                            padding: "14px 22px",
                            background: "#fff",
                            border: "1.5px solid var(--color-accent, #4f46e5)",
                            borderRadius: 12,
                            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                            animation: "toast-in 0.2s ease",
                            minWidth: 240,
                            maxWidth: "80vw",
                        }}
                    >
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-accent, #4f46e5)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                            {a.title}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>
                            {a.body}
                        </div>
                    </div>
                ))}
            </div>

            <style>{`
                @keyframes toast-in {
                    from { opacity: 0; transform: translateY(-10px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </ToastContext.Provider>
    );
}
