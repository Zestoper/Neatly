import { api } from "./client";

// POST /briefing/generate — AI 일간 브리핑 생성 (Premium 전용)
// date      : YYYY-MM-DD (없으면 오늘)
// folderId  : 있으면 해당 폴더 문서만 요약
export const generateBriefing = async (folderId?: string, date?: string) => {
    const params: Record<string, string> = {};
    if (folderId) params.folder_id = folderId;
    if (date) params.date = date;
    const res = await api.post("/briefing/generate", null, {
        params: Object.keys(params).length ? params : undefined,
    });
    return res.data;
};

// GET /briefing/date?date=YYYY-MM-DD — 특정 날짜 브리핑 조회
export const getBriefingByDate = async (date: string) => {
    const res = await api.get("/briefing/date", { params: { date } });
    return res.data;
};

// GET /briefing/today — 오늘 브리핑 조회 (하위 호환)
export const getTodayBriefing = async () => {
    const res = await api.get("/briefing/today");
    return res.data;
};
