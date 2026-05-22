import { useEffect, useRef } from "react";
import { getTodayEvents } from "../api/calendar";
import { useToast } from "../context/ToastContext";

const STORAGE_KEY = "notified_calendar_events";
const POLL_INTERVAL = 60 * 1000;

function getNotified(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return new Set(raw ? JSON.parse(raw) : []);
    } catch {
        return new Set();
    }
}

function markNotified(id: string) {
    const set = getNotified();
    set.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

function clearOldNotified() {
    const lastDate = localStorage.getItem("notified_date");
    const today = new Date().toISOString().slice(0, 10);
    if (lastDate !== today) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem("notified_date", today);
    }
}

export function useCalendarNotifications() {
    const { showToast } = useToast();
    const showToastRef = useRef(showToast);
    showToastRef.current = showToast;

    useEffect(() => {
        clearOldNotified();

        const notify = (title: string, body: string) => {
            // 브라우저 알림이 가능하면 사용, 아니면 토스트로 대체
            if ("Notification" in window && Notification.permission === "granted") {
                new Notification(title, { body, icon: "/favicon.ico" });
            } else {
                showToastRef.current(`${body}`);
            }
        };

        const check = async () => {
            clearOldNotified();
            try {
                const events = await getTodayEvents();
                const notified = getNotified();

                for (const ev of events) {
                    if (notified.has(ev.id)) continue;

                    const eventTime = new Date(ev.event_date);
                    const now = new Date();
                    const diffMin = (eventTime.getTime() - now.getTime()) / 60000;

                    if (diffMin <= 10) {
                        const timeStr = eventTime.toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                        });
                        notify("Neatly 일정 알림", `${timeStr} ${ev.title}`);
                        markNotified(ev.id);
                    }
                }
            } catch {
                // 네트워크 오류 무시
            }
        };

        // 브라우저 알림 권한 확인 후 즉시 체크
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().then(() => check());
        } else {
            check();
        }

        const timer = setInterval(check, POLL_INTERVAL);
        return () => clearInterval(timer);
    }, []);
}
