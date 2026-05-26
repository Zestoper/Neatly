import { useEffect, useRef } from "react";
import { getTodayEvents } from "../api/calendar";
import { useToast } from "../context/ToastContext";

const POLL_INTERVAL = 60 * 1000; // 1분마다 — 백그라운드에서 배터리 절약

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type NotifState = Record<string, { warned?: boolean; started?: boolean }>;

function loadState(): NotifState {
    try {
        const savedDate = localStorage.getItem("notif_date");
        if (savedDate !== getTodayStr()) {
            localStorage.removeItem("notif_state");
            localStorage.setItem("notif_date", getTodayStr());
            return {};
        }
        return JSON.parse(localStorage.getItem("notif_state") ?? "{}");
    } catch {
        return {};
    }
}

function saveState(state: NotifState) {
    localStorage.setItem("notif_state", JSON.stringify(state));
    localStorage.setItem("notif_date", getTodayStr());
}

export function useCalendarNotifications() {
    const { showCalendarAlert } = useToast();
    const alertRef = useRef(showCalendarAlert);
    alertRef.current = showCalendarAlert;

    useEffect(() => {
        const check = async () => {
            try {
                const events = await getTodayEvents();
                const state = loadState();
                let changed = false;

                for (const ev of events) {
                    const s = state[ev.id] ?? {};

                    const eventTime = new Date(ev.event_date);
                    const now = new Date();
                    const diffMin = (eventTime.getTime() - now.getTime()) / 60000;

                    const timeStr = eventTime.toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                    });

                    const links: { label: string; path: string }[] = [];
                    if (ev.document) links.push({ label: "문서로 이동", path: `/documents/${ev.document.id}` });
                    if (ev.email_id) links.push({ label: "이메일로 이동", path: `/emails/${ev.email_id}` });

                    // 5분 전 사전 알림 (앱을 늦게 켰을 때도 잡히도록 7분까지 허용)
                    if (!s.warned && diffMin > 0 && diffMin <= 7) {
                        const body = `${timeStr} ${ev.title} 5분 후 시작됩니다`;
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification("Neatly 일정 알림", { body, icon: "/favicon.ico" });
                        }
                        alertRef.current("일정 알림", body, links.length > 0 ? links : undefined);
                        s.warned = true;
                        changed = true;
                    }

                    // 정시 알림: 앱을 늦게 켜도 잡히도록 15분까지 허용
                    if (!s.started && diffMin <= 0 && diffMin > -15) {
                        const body = `${timeStr} ${ev.title} 시간입니다`;
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification("Neatly 일정 알림", { body, icon: "/favicon.ico" });
                        }
                        alertRef.current("일정 알림", body, links.length > 0 ? links : undefined);
                        s.started = true;
                        changed = true;
                    }

                    state[ev.id] = s;
                }

                if (changed) saveState(state);
            } catch {
                // 네트워크 오류 무시
            }
        };

        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().then(() => check());
        } else {
            check();
        }

        // 모바일에서 탭이 백그라운드에서 돌아올 때 즉시 체크
        const handleVisibility = () => {
            if (document.visibilityState === "visible") check();
        };
        document.addEventListener("visibilitychange", handleVisibility);

        const timer = setInterval(check, POLL_INTERVAL);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, []);
}
