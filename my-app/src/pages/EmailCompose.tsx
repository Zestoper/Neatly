import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { generateDraft, sendNewEmail } from "../api/emails";
import styles from "./EmailCompose.module.css";

export default function EmailCompose() {
    const navigate = useNavigate();

    const [to, setTo] = useState("");
    const [subject, setSubject] = useState("");
    const [intent, setIntent] = useState("");
    const [body, setBody] = useState("");

    const [generating, setGenerating] = useState(false);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        if (!intent.trim()) return;
        setGenerating(true);
        setError(null);
        try {
            const { body: draft } = await generateDraft(to, subject, intent);
            setBody(draft);
        } catch {
            setError("AI 초안 생성에 실패했습니다. 다시 시도해주세요.");
        } finally {
            setGenerating(false);
        }
    };

    const handleSend = async () => {
        if (!to.trim() || !subject.trim() || !body.trim()) return;
        setSending(true);
        setError(null);
        try {
            await sendNewEmail(to, subject, body);
            setSent(true);
        } catch (err: any) {
            if (err.response?.status === 403) {
                setError("Gmail 전송 권한이 없습니다. Settings에서 Gmail을 다시 연결해주세요.");
            } else {
                setError("메일 전송에 실패했습니다. 다시 시도해주세요.");
            }
        } finally {
            setSending(false);
        }
    };

    const canSend = to.trim() && subject.trim() && body.trim() && !sending && !sent;

    if (sent) {
        return (
            <div className={styles.container}>
                <button className={styles.backButton} onClick={() => navigate("/emails")}>
                    ← Emails
                </button>
                <div className={styles.sentBox}>
                    <p className={styles.sentTitle}>메일이 전송되었습니다.</p>
                    <button className={styles.backToEmailsButton} onClick={() => navigate("/emails")}>
                        받은 메일함으로
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <button className={styles.backButton} onClick={() => navigate("/emails")}>
                ← Emails
            </button>

            <h1 className={styles.heading}>메일 작성</h1>

            <div className={styles.form}>
                <div className={styles.field}>
                    <label className={styles.label}>받는 사람</label>
                    <input
                        className={styles.input}
                        type="email"
                        placeholder="example@email.com"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                    />
                </div>

                <div className={styles.field}>
                    <label className={styles.label}>제목</label>
                    <input
                        className={styles.input}
                        type="text"
                        placeholder="메일 제목"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                    />
                </div>

                <div className={styles.field}>
                    <label className={styles.label}>어떤 내용을 전달하실 건가요?</label>
                    <div className={styles.intentRow}>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="예: 다음 주 회의 일정 조율 요청"
                            value={intent}
                            onChange={(e) => setIntent(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                        />
                        <button
                            className={styles.generateButton}
                            onClick={handleGenerate}
                            disabled={generating || !intent.trim()}
                        >
                            {generating ? "생성 중..." : "AI 초안"}
                        </button>
                    </div>
                </div>

                <div className={styles.field}>
                    <label className={styles.label}>본문</label>
                    <textarea
                        className={styles.textarea}
                        rows={12}
                        placeholder="내용을 입력하거나 위에서 AI 초안을 생성하세요."
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                    />
                </div>

                {error && <p className={styles.error}>{error}</p>}

                <div className={styles.actions}>
                    <button
                        className={styles.cancelButton}
                        onClick={() => navigate("/emails")}
                        disabled={sending}
                    >
                        취소
                    </button>
                    <button
                        className={styles.sendButton}
                        onClick={handleSend}
                        disabled={!canSend}
                    >
                        {sending ? "전송 중..." : "보내기"}
                    </button>
                </div>
            </div>
        </div>
    );
}
