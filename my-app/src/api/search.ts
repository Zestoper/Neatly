import { api } from "./client";

// GET /search?q=... — 문서 전체(제목·본문·요약·태그)에서 검색
export const searchDocuments = async (q: string) => {
    const res = await api.get("/search", { params: { q } });
    return res.data;
};
