import { useEffect, useRef } from "react";
import { getTodayEvents } from "../api/calendar";
import { useToast } from "../context/ToastContext";

const NOTIFIED_KEY = "notified_calendar_events";
const NOTIFIED_DATE_KEY = "notified_calendar_date";
const POLL_INTERVAL = 60 * 1000;

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getNotified(): Set<string> {
    // 날짜가 바뀌면 초기화
    const savedDate = localStorage.getItem(NOTIFIED_DATE_KEY);
    const today = getTodayStr();
    if (savedDate !== today) {
        localStorage.removeItem(NOTIFIED_KEY);
        localStorage.setItem(NOTIFIED_DATE_KEY, today);
        return new Set();
    }
    try {
        const raw = localStorage.getItem(NOTIFIED_KEY);
        return new Set(raw ? JSON.parse(raw) : []);
    } catch {
        return new Set();
    }
}

function markNotified(id: string) {
    const set = getNotified();
    set.add(id);
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]));
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
            // 브라우저 알림 허용 여부와 관계없이 항상 인앱 알림도 표시
            alertRef.current("일정 알림", body);
        };

        const check = async () => {
            try {
                const events = await getTodayEvents();
                const notified = getNotified();

                for (const ev of events) {
                    if (notified.has(ev.id)) continue;

                    const eventTime = new Date(ev.event_date);
                    const now = new Date();
                    const diffMin = (eventTime.getTime() - now.getTime()) / 60000;

                    // 이미 지났거나 10분 이내인 일정
                    if (diffMin <= 10) {
                        const timeStr = eventTime.toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                        });
                        notify(`${timeStr} ${ev.title}`);
                        markNotified(ev.id);
                    }
                }
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
