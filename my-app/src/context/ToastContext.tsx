import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

type ToastType = "success" | "error";

type ToastItem = {
    id: number;
    message: string;
    type: ToastType;
};

type AlertLink = {
    label: string;
    path: string;
};

type AlertItem = {
    id: number;
    title: string;
    body: string;
    links?: AlertLink[];
};

type ToastContextValue = {
    showToast: (message: string, type?: ToastType) => void;
    showCalendarAlert: (title: string, body: string, links?: AlertLink[]) => void;
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

    const showCalendarAlert = useCallback((title: string, body: string, links?: AlertLink[]) => {
        const id = Date.now();
        setAlerts((prev) => [...prev, { id, title, body, links }]);
        setTimeout(() => {
            setAlerts((prev) => prev.filter((a) => a.id !== id));
        }, 8000);
    }, []);

    const dismissAlert = (id: number) => {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
    };

    return (
        <ToastContext.Provider value={{ showToast, showCalendarAlert }}>
            {children}

            {/* 일반 토스트 — 상단 우측 */}
            <div style={{
                position: "fixed",
                top: 24,
                right: 16,
                maxWidth: "calc(100vw - 32px)",
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
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            animation: "toast-in 0.18s ease",
                        }}
                    >
                        {t.message}
                    </div>
                ))}
            </div>

            {/* 캘린더 알림 — 상단 중앙 */}
            <div style={{
                position: "fixed",
                top: 24,
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                zIndex: 10000,
                pointerEvents: "auto",
            }}>
                {alerts.map((a) => (
                    <div
                        key={a.id}
                        style={{
                            padding: "14px 18px",
                            background: "#fff",
                            border: "1.5px solid var(--color-accent, #4f46e5)",
                            borderRadius: 12,
                            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                            animation: "toast-in 0.2s ease",
                            minWidth: 260,
                            maxWidth: "80vw",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-accent, #4f46e5)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                                    {a.title}
                                </div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>
                                    {a.body}
                                </div>
                            </div>
                            <button
                                onClick={() => dismissAlert(a.id)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                            >
                                ✕
                            </button>
                        </div>

                        {a.links && a.links.length > 0 && (
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                {a.links.map((link) => (
                                    <button
                                        key={link.path}
                                        onClick={() => { dismissAlert(a.id); window.location.href = link.path; }}
                                        style={{
                                            padding: "5px 12px",
                                            fontSize: 12,
                                            fontWeight: 600,
                                            border: "1px solid var(--color-accent, #4f46e5)",
                                            borderRadius: 6,
                                            background: "none",
                                            color: "var(--color-accent, #4f46e5)",
                                            cursor: "pointer",
                                        }}
                                    >
                                        {link.label}
                                    </button>
                                ))}
                            </div>
                        )}
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
