import { api } from "./client";

export const summarizeDocument = async (content: string) => {
    const res = await api.post("/ai/summarize", { content });
    return res.data.summary as string;
};

export type ChatHistory = { role: "user" | "ai"; text: string }[];

// POST /ai/ask — document_id 또는 contextText 중 하나로 AI에게 질문 (Standard 이상)
export const askAi = async (opts: {
    documentId?: string;
    contextText?: string;
    question: string;
    history?: ChatHistory;
}) => {
    const res = await api.post("/ai/ask", {
        document_id: opts.documentId,
        text: opts.contextText,
        question: opts.question,
        history: opts.history ?? [],
    });
    return res.data.answer as string;
};
