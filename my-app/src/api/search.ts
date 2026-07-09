import { api } from "./client";

export const searchDocuments = async (q: string) => {
    const res = await api.get("/search", { params: { q } });
    return res.data;
};
