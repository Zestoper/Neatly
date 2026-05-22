import { useEffect, useRef } from "react";
import { getTodayEvents } from "../api/calendar";
import { useToast } from "../context/ToastContext";

const POLL_INTERVAL = 60 * 1000;

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type NotifState = Record<string, { reminded?: boolean; started?: boolean }>;

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
        const notify = (body: string) => {
            if ("Notification" in window && Notification.permission === "granted") {
                new Notification("Neatly 일정 알림", { body, icon: "/favicon.ico" });
            }
            alertRef.current("일정 알림", body);
        };

        const check = async () => {
            try {
                const events = await getTodayEvents();
                const state = loadState();
                let changed = false;

                for (const ev of events) {
                    const eventTime = new Date(ev.event_date);
                    const now = new Date();
                    const diffMin = (eventTime.getTime() - now.getTime()) / 60000;
                    const s = state[ev.id] ?? {};

                    const timeStr = eventTime.toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                    });

                    // 정시 알림: 일정 시작 1분 이내 (diffMin이 -1 ~ 0 사이)
                    if (diffMin > -1 && diffMin <= 0 && !s.started) {
                        notify(`${timeStr} ${ev.title} 시작`);
                        s.started = true;
                        changed = true;
                    }

                    // 사전 알림: 10분 전 ~ 1분 전 (아직 안 됐고 사전 알림 안 한 것만)
                    if (diffMin > 0 && diffMin <= 10 && !s.reminded) {
                        notify(`${timeStr} ${ev.title} — ${Math.round(diffMin)}분 후 시작`);
                        s.reminded = true;
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

        const timer = setInterval(check, POLL_INTERVAL);
        return () => clearInterval(timer);
    }, []);
}
