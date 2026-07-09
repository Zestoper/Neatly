import { api } from "./client";

export type EmailDetail = {
    id: string;
    subject: string;
    from_: string;
    date: string;
    body: string;
    raw_html: string;
    is_spam: boolean;
    is_unread: boolean;
    summary: string | null;
};

export const getEmailDetail = async (id: string): Promise<EmailDetail> => {
    const res = await api.get(`/emails/${id}`);
    return res.data;
};

export const markEmailAsRead = async (id: string): Promise<void> => {
    await api.patch(`/emails/${id}/read`);
};

export const trashEmail = async (id: string): Promise<void> => {
    await api.delete(`/emails/${id}`);
};

export const generateReply = async (id: string): Promise<{ reply_text: string }> => {
    const res = await api.post(`/emails/${id}/generate-reply`);
    return res.data;
};

export const sendReply = async (id: string, reply_text: string): Promise<void> => {
    await api.post(`/emails/${id}/send-reply`, { reply_text });
};

export const generateDraft = async (to: string, subject: string, intent: string): Promise<{ body: string }> => {
    const res = await api.post("/emails/generate-draft", { to, subject, intent });
    return res.data;
};

export const sendNewEmail = async (to: string, subject: string, body: string): Promise<void> => {
    await api.post("/emails/send-new", { to, subject, body });
};
