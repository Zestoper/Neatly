import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

let redirecting = false;

export const api = axios.create({
    baseURL: BASE_URL,
    timeout: 90000,
});

// ── 서버 시각 보정 ──
// 서버 DB 시각(created_at · last_sync 등)은 UTC인데 시간대 표시 없이("2026-11-02T12:08:00") 내려온다.
// 그대로 new Date() 하면 브라우저가 한국 시각으로 읽어서 9시간 일찍 보였다 (예: 21:08 동기화가 12:08로 표시).
// 응답을 받을 때 시간대 없는 시각에 Z(UTC)를 붙여 둔다.
// 단 캘린더 일정(event_date)은 원래 한국 시각으로 저장하므로 그대로 둔다.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const KEEP_LOCAL_KEYS = new Set(["event_date"]);

function markUtc(value: unknown, key?: string): unknown {
    if (typeof value === "string") {
        return key && !KEEP_LOCAL_KEYS.has(key) && NAIVE_DATETIME.test(value) ? `${value}Z` : value;
    }
    if (Array.isArray(value)) return value.map((v) => markUtc(v, key));
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = markUtc(v, k);
        return out;
    }
    return value;
}

api.interceptors.response.use((response) => {
    response.data = markUtc(response.data);
    return response;
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;

    }

    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && !redirecting) {
            redirecting = true;
            localStorage.removeItem("token");
            window.location.href = "/login";
        }
        return Promise.reject(error);
    }
);
