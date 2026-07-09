import { api } from "./client";

export const generateBriefing = async (folderId?: string, date?: string) => {
    const params: Record<string, string> = {};
    if (folderId) params.folder_id = folderId;
    if (date) params.date = date;
    const res = await api.post("/briefing/generate", null, {
        params: Object.keys(params).length ? params : undefined,
    });
    return res.data;
};

export const getBriefingByDate = async (date: string) => {
    const res = await api.get("/briefing/date", { params: { date } });
    return res.data;
};

export const getTodayBriefing = async () => {
    const res = await api.get("/briefing/today");
    return res.data;
};
