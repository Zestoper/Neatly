import { api } from "./client";
import { notifyEmailsChanged } from "./emails";

export const syncEmails = async () => {
    const res = await api.post("/emails/sync");
    notifyEmailsChanged();
    return res.data;
};

export const getSyncStatus = async () => {
    const res = await api.get("/emails/sync/status");
    return res.data;
};

export const markEmailsViewed = async () => {
    await api.post("/emails/mark-viewed");
};
