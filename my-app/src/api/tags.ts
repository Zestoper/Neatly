import { api } from "./client";

// GET /tags — 내 태그 목록
export const getTags = async () => {
    const res = await api.get("/tags");
    return res.data;
};

// POST /documents/{id}/tags — 문서에 태그 추가 (태그 이름으로 — 없으면 자동 생성)
export const addTagToDocument = async (documentId: string, tagName: string) => {
    const res = await api.post(`/documents/${documentId}/tags`, { name: tagName });
    return res.data; // 추가된 태그 객체 반환
};

// DELETE /documents/{id}/tags/{tagId} — 문서에서 태그 제거
export const removeTagFromDocument = async (documentId: string, tagId: string) => {
    const res = await api.delete(`/documents/${documentId}/tags/${tagId}`);
    return res.data;
};
