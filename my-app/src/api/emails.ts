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

// 안 읽은 메일 수가 바뀌는 동작 뒤에 보내는 신호 — 사이드바·대시보드 숫자가 바로 다시 불러온다
export const EMAILS_CHANGED = "neatly:emails-changed";
export const notifyEmailsChanged = () => window.dispatchEvent(new Event(EMAILS_CHANGED));

export const markEmailAsRead = async (id: string): Promise<void> => {
    await api.patch(`/emails/${id}/read`);
    notifyEmailsChanged();
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
