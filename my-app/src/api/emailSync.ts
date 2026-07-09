import { api } from "./client";

export const syncEmails = async () => {
    const res = await api.post("/emails/sync");
    return res.data;
};

export const getSyncStatus = async () => {
    const res = await api.get("/emails/sync/status");
    return res.data;
};

export const markEmailsViewed = async () => {
    await api.post("/emails/mark-viewed");
};
