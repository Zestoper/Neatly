import { api } from "./client";

export const getTags = async () => {
    const res = await api.get("/tags");
    return res.data;
};

export const addTagToDocument = async (documentId: string, tagName: string) => {
    const res = await api.post(`/documents/${documentId}/tags`, { name: tagName });
    return res.data;
};

export const removeTagFromDocument = async (documentId: string, tagId: string) => {
    const res = await api.delete(`/documents/${documentId}/tags/${tagId}`);
    return res.data;
};
