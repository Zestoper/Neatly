import { api } from "./client";

export type CalendarEvent = {
    id: string;
    title: string;
    description: string | null;
    event_date: string;
    document_id: string | null;
    document: { id: string; title: string } | null;
    email_id: string | null;
    email_subject: string | null;
    auto_extracted?: boolean;
    created_at: string;
};

export const getEvents = async (year: number, month: number): Promise<CalendarEvent[]> => {
    const res = await api.get("/calendar/events", { params: { year, month } });
    return res.data;
};

export const getTodayEvents = async (): Promise<CalendarEvent[]> => {
    const d = new Date();
    const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const res = await api.get("/calendar/events/today", { params: { client_date: localDate } });
    return res.data;
};

export const createEvent = async (
    title: string,
    event_date: string,
    description?: string,
    document_id?: string | null,
    email_id?: string | null,
    email_subject?: string | null,
): Promise<CalendarEvent> => {
    const res = await api.post("/calendar/events", { title, event_date, description, document_id, email_id, email_subject });
    return res.data;
};

export const updateEvent = async (
    id: string,
    data: Partial<Pick<CalendarEvent, "title" | "description" | "event_date" | "document_id" | "email_id" | "email_subject">>,
): Promise<CalendarEvent> => {
    const res = await api.put(`/calendar/events/${id}`, data);
    return res.data;
};

export const deleteEvent = async (id: string): Promise<void> => {
    await api.delete(`/calendar/events/${id}`);
};

// 메일에서 AI가 찾은 일정 — 사용자가 확인하기 전까지 캘린더에 안 보이는 '제안'
export const getSuggestions = async (): Promise<CalendarEvent[]> => {
    const res = await api.get("/calendar/suggestions");
    return res.data;
};

export const confirmSuggestion = async (
    id: string,
    data?: { title?: string; event_date?: string },
): Promise<CalendarEvent> => {
    const res = await api.post(`/calendar/suggestions/${id}/confirm`, data ?? {});
    return res.data;
};
