import { api } from "./client";

export type EmailFilter = {
    id: string;
    sender: string;
    name: string | null;
};

export const getEmailFilters = async (): Promise<EmailFilter[]> => {
    const res = await api.get("/email-filters");
    return res.data;
};

export const createEmailFilter = async (
    sender: string,
    name?: string,
): Promise<EmailFilter> => {
    const res = await api.post("/email-filters", { sender, name: name ?? null });
    return res.data;
};

export const deleteEmailFilter = async (id: string): Promise<void> => {
    await api.delete(`/email-filters/${id}`);
};
