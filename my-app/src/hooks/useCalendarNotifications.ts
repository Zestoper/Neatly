import { useEffect, useRef } from "react";
import { getTodayEvents } from "../api/calendar";

const STORAGE_KEY = "notified_calendar_events";
const POLL_INTERVAL = 60 * 1000; // 1분마다 확인

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
    // 날짜가 바뀌면 이전 알림 기록을 초기화
    const lastDate = localStorage.getItem("notified_date");
    const today = new Date().toISOString().slice(0, 10);
    if (lastDate !== today) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem("notified_date", today);
    }
}

export function useCalendarNotifications() {
    const permissionRef = useRef<NotificationPermission>("default");

    useEffect(() => {
        if (!("Notification" in window)) return;

        // 권한 요청 (이미 granted/denied면 바로 반환)
        Notification.requestPermission().then((perm) => {
            permissionRef.current = perm;
        });

        clearOldNotified();

        const check = async () => {
            if (permissionRef.current !== "granted") return;
            clearOldNotified();

            try {
                const events = await getTodayEvents();
                const notified = getNotified();

                for (const ev of events) {
                    if (notified.has(ev.id)) continue;

                    const eventTime = new Date(ev.event_date);
                    const now = new Date();
                    const diffMin = (eventTime.getTime() - now.getTime()) / 60000;

                    // 이미 지났거나 10분 이내인 일정만 알림
                    if (diffMin <= 10) {
                        const timeStr = eventTime.toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                        });
                        new Notification("Neatly 일정 알림", {
                            body: `${timeStr} ${ev.title}`,
                            icon: "/favicon.ico",
                        });
                        markNotified(ev.id);
                    }
                }
            } catch {
                // 네트워크 오류 무시
            }
        };

        check();
        const timer = setInterval(check, POLL_INTERVAL);
        return () => clearInterval(timer);
    }, []);
}
