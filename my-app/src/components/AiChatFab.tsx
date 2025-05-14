import { useRef, useState } from "react";
import { askAi } from "../api/ai";
import type { ChatHistory } from "../api/ai";
import styles from "./AiChatFab.module.css";

type ChatMessage = { role: "user" | "ai"; text: string };

type Props = {
    documentId?: string;
    contextText?: string;
};

export default function AiChatFab({ documentId, contextText }: Props) {
    const plan = localStorage.getItem("plan");
    if (plan !== "STANDARD" && plan !== "PREMIUM") return null;

    const [open, setOpen] = useState(false);
    const [question, setQuestion] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    const handleClose = () => setOpen(false);

    const handleAsk = async () => {
        const q = question.trim();
        if (!q || loading) return;
        setQuestion("");
        setMessages((prev) => [...prev, { role: "user", text: q }]);
        setLoading(true);
        try {
            const history: ChatHistory = messages;
            const result = await askAi({ documentId, contextText, question: q, history });
            setMessages((prev) => [...prev, { role: "ai", text: result }]);
        } catch {
            setMessages((prev) => [...prev, { role: "ai", text: "답변을 가져오지 못했습니다." }]);
        } finally {
            setLoading(false);
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
    };

    return (
        <>
            <button className={styles.fab} onClick={() => setOpen(true)} title="AI에게 질문">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C12 2 13.3 8.3 20 10C13.3 11.7 12 18 12 18C12 18 10.7 11.7 4 10C10.7 8.3 12 2 12 2Z"/>
                    <path d="M19 2C19 2 19.8 4.8 22 5.5C19.8 6.2 19 9 19 9C19 9 18.2 6.2 16 5.5C18.2 4.8 19 2 19 2Z"/>
                </svg>
            </button>

            {open && (
                <div className={styles.overlay} onClick={handleClose}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.header}>
                            <p className={styles.title}>AI에게 질문</p>
                            <button className={styles.closeBtn} onClick={handleClose}>×</button>
                        </div>

                        <div className={styles.chatBody}>
                            {messages.length === 0 && (
                                <p className={styles.chatEmpty}>이 내용을 바탕으로 답변합니다.</p>
                            )}
                            {messages.map((msg, i) => (
                                <div
                                    key={i}
                                    className={msg.role === "user" ? styles.bubbleUser : styles.bubbleAi}
                                >
                                    {msg.text}
                                </div>
                            ))}
                            {loading && (
                                <div className={styles.bubbleAi}>
                                    <span className={styles.typing}>
                                        <span /><span /><span />
                                    </span>
                                </div>
                            )}
                            <div ref={bottomRef} />
                        </div>

                        <div className={styles.inputRow}>
                            <input
                                className={styles.input}
                                placeholder="질문을 입력하세요"
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); handleAsk(); }
                                }}
                                disabled={loading}
                                autoFocus
                            />
                            <button
                                className={styles.sendBtn}
                                onClick={handleAsk}
                                disabled={loading || !question.trim()}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="22" y1="2" x2="11" y2="13" />
                                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
