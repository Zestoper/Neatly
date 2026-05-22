import { api } from "./client";

export type CalendarEvent = {
    id: string;
    title: string;
    description: string | null;
    event_date: string;
    created_at: string;
};

export const getEvents = async (year: number, month: number): Promise<CalendarEvent[]> => {
    const res = await api.get("/calendar/events", { params: { year, month } });
    return res.data;
};

export const getTodayEvents = async (): Promise<CalendarEvent[]> => {
    const res = await api.get("/calendar/events/today");
    return res.data;
};

export const createEvent = async (
    title: string,
    event_date: string,
    description?: string,
): Promise<CalendarEvent> => {
    const res = await api.post("/calendar/events", { title, event_date, description });
    return res.data;
};

export const updateEvent = async (
    id: string,
    data: Partial<Pick<CalendarEvent, "title" | "description" | "event_date">>,
): Promise<CalendarEvent> => {
    const res = await api.put(`/calendar/events/${id}`, data);
    return res.data;
};

export const deleteEvent = async (id: string): Promise<void> => {
    await api.delete(`/calendar/events/${id}`);
};
