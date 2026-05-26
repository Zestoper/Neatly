import { api } from "./client";

// EmailDetail : GET /emails/{id} 응답 형식 — 이메일 상세 내용
export type EmailDetail = {
    id: string;
    subject: string;
    from_: string;
    date: string;
    body: string;               // 플레인 텍스트 본문
    raw_html: string;           // HTML 본문 (있을 때만)
    is_spam: boolean;           // 스팸함에 있는 메일인지 여부
    is_unread: boolean;         // UNREAD 라벨이 있으면 true
    summary: string | null;     // AI 요약문 — 본문이 없으면 null
};

// GET /emails/{id} — 이메일 한 건의 전체 본문 조회
export const getEmailDetail = async (id: string): Promise<EmailDetail> => {
    const res = await api.get(`/emails/${id}`);
    return res.data;
};

// PATCH /emails/{id}/read — 이메일을 읽음으로 표시 (UNREAD 라벨 제거)
export const markEmailAsRead = async (id: string): Promise<void> => {
    await api.patch(`/emails/${id}/read`);
};

// DELETE /emails/{id} — Gmail 이메일을 휴지통으로 이동
export const trashEmail = async (id: string): Promise<void> => {
    await api.delete(`/emails/${id}`);
};

// POST /emails/{id}/generate-reply — 원본 이메일 기반 AI 답장 초안 생성
export const generateReply = async (id: string): Promise<{ reply_text: string }> => {
    const res = await api.post(`/emails/${id}/generate-reply`);
    return res.data;
};

// POST /emails/{id}/send-reply — 작성된 답장을 Gmail로 전송
export const sendReply = async (id: string, reply_text: string): Promise<void> => {
    await api.post(`/emails/${id}/send-reply`, { reply_text });
};
