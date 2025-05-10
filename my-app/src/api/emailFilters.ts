import { api } from "./client";

export type EmailFilter = {
    id: string;
    sender: string;       // sender : 이메일 주소 (아이디)
    name: string | null;  // name : 발신자 이름 (없으면 null)
};

// GET /email-filters — 내 필터 목록
export const getEmailFilters = async (): Promise<EmailFilter[]> => {
    const res = await api.get("/email-filters");
    return res.data;
};

// POST /email-filters — 필터 추가
export const createEmailFilter = async (
    sender: string,
    name?: string,
): Promise<EmailFilter> => {
    const res = await api.post("/email-filters", { sender, name: name ?? null });
    return res.data;
};

// DELETE /email-filters/{id} — 필터 삭제
export const deleteEmailFilter = async (id: string): Promise<void> => {
    await api.delete(`/email-filters/${id}`);
};
