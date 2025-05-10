import { api } from "./client";

// POST /emails/sync — Gmail 즉시 동기화 (Premium 전용)
// 반환: { synced: number, last_sync: string | null }
export const syncEmails = async () => {
    const res = await api.post("/emails/sync");
    return res.data;
};

// GET /emails/sync/status — 마지막 동기화 시각 + 안 읽은 새 문서 수 조회
// 반환: { last_sync: string | null, new_count: number }
export const getSyncStatus = async () => {
    const res = await api.get("/emails/sync/status");
    return res.data;
};

// POST /emails/mark-viewed — Emails 페이지 열었음 기록 → 뱃지 카운트 초기화
export const markEmailsViewed = async () => {
    await api.post("/emails/mark-viewed");
};
