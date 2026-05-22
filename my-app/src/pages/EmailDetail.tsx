import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getEmailDetail, markEmailAsRead, trashEmail } from "../api/emails";
import type { EmailDetail as EmailDetailType } from "../api/emails";
import { api } from "../api/client";
import { useRefresh } from "../context/RefreshContext";
import AiChatFab from "../components/AiChatFab";
import ConfirmModal from "../components/ConfirmModal";
import styles from "./EmailDetail.module.css";

export default function EmailDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { bump } = useRefresh();

    const [email, setEmail] = useState<EmailDetailType | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);

    const [markingSpam, setMarkingSpam] = useState(false);
    const [markedSpam, setMarkedSpam] = useState(false);
    const [spamError, setSpamError] = useState<string | null>(null);
    // spamError : 스팸 처리/해제 실패 메시지 — null이면 오류 없음

    const [unmarkingSpam, setUnmarkingSpam] = useState(false);
    const [unmarkedSpam, setUnmarkedSpam] = useState(false);
    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

    useEffect(() => {
        if (!id) return;
        getEmailDetail(id)
            .then((data) => {
                setEmail(data);
                if (data.is_unread) markEmailAsRead(id).catch(() => {});
            })
            .catch(() => setFetchError(true))
            .finally(() => setLoading(false));
    }, [id]);

    const handleUnmarkSpam = async () => {
        if (!id || !email) return;
        setUnmarkingSpam(true);
        setSpamError(null);
        try {
            await api.delete(`/emails/${id}/spam`);
            setUnmarkedSpam(true);
        } catch {
            setSpamError("오류가 발생했습니다. 다시 시도해주세요.");
        } finally {
            setUnmarkingSpam(false);
        }
    };

    const handleTrash = () => {
        if (!id) return;
        setConfirmModal({
            message: "이 이메일을 Gmail 휴지통으로 이동할까요?",
            onConfirm: async () => {
                setConfirmModal(null);
                await trashEmail(id);
                bump();
                navigate("/emails");
            },
        });
    };

    const handleMarkSpam = async () => {
        if (!id || !email) return;
        setMarkingSpam(true);
        setSpamError(null);
        try {
            await api.post(`/emails/${id}/spam`);
            setMarkedSpam(true);
        } catch (err: any) {
            if (err.response?.status === 403) {
                // gmail.readonly 토큰으로 시도 — Settings에서 재연결 필요
                setSpamError("Gmail 권한이 부족합니다. Settings에서 Gmail을 다시 연결해주세요.");
            } else {
                setSpamError("오류가 발생했습니다. 다시 시도해주세요.");
            }
        } finally {
            setMarkingSpam(false);
        }
    };

    if (loading) return <p>불러오는 중...</p>;
    if (fetchError) return <p>이메일을 불러올 수 없습니다. 잠시 후 다시 시도해주세요.</p>;
    if (!email) return <p>이메일을 찾을 수 없습니다.</p>;

    return (
        <div className={styles.container}>
            {/* 뒤로 가기 */}
            <button className={styles.backButton} onClick={() => navigate("/emails")}>
                ← Emails
            </button>

            {/* 제목 + 스팸 버튼 */}
            <div className={styles.header}>
                <h1 className={styles.subject}>{email.subject}</h1>
                <div className={styles.actions}>
                    {/* 스팸함 메일이면 해제 버튼, 일반 메일이면 스팸 처리 버튼 */}
                    {(email.is_spam && !unmarkedSpam) ? (
                        <button
                            className={styles.spamButton}
                            onClick={handleUnmarkSpam}
                            disabled={unmarkingSpam}
                        >
                            {unmarkingSpam ? "처리 중..." : "스팸 해제"}
                        </button>
                    ) : email.is_spam && unmarkedSpam ? (
                        <button className={styles.spammedButton} disabled>
                            스팸 해제됨
                        </button>
                    ) : (
                        <button
                            className={markedSpam ? styles.spammedButton : styles.spamButton}
                            onClick={handleMarkSpam}
                            disabled={markingSpam || markedSpam}
                        >
                            {markingSpam ? "처리 중..." : markedSpam ? "스팸 처리됨" : "스팸으로 표시"}
                        </button>
                    )}
                    <button className={styles.deleteButton} onClick={handleTrash}>
                        삭제
                    </button>
                </div>
            </div>

            {/* 발신자 · 날짜 메타 */}
            <div className={styles.meta}>
                <span className={styles.from}>{email.from_}</span>
                <span className={styles.date}>{email.date}</span>
            </div>

            {/* 스팸 처리 실패 시 안내 메시지 */}
            {spamError && <p className={styles.errorMsg}>{spamError}</p>}

            {/* AI 요약 */}
            {email.summary && (() => {
                const plan = localStorage.getItem("plan");
                const isFree = plan !== "STANDARD" && plan !== "PREMIUM";
                return (
                    <div className={styles.summaryBox}>
                        <p className={styles.summaryLabel}>AI 요약</p>
                        <p className={isFree ? styles.summaryTextBlurred : styles.summaryText}>
                            {email.summary}
                        </p>
                        {isFree && (
                            <div className={styles.summaryOverlay}>
                                <p className={styles.summaryOverlayText}>
                                    AI 요약은 Standard 플랜부터 사용할 수 있어요.
                                </p>
                                <button
                                    className={styles.upgradeButton}
                                    onClick={() => navigate("/plans")}
                                >
                                    업그레이드
                                </button>
                            </div>
                        )}
                    </div>
                );
            })()}

            <hr className={styles.divider} />

            {/* 이메일 본문 */}
            {email.raw_html ? (
                <iframe
                    className={styles.emailFrame}
                    srcDoc={email.raw_html}
                    sandbox="allow-same-origin"
                    title="이메일 본문"
                />
            ) : (
                <p className={styles.body}>{email.body || "(본문 없음)"}</p>
            )}

            <AiChatFab contextText={email.body ?? email.subject} />

            {confirmModal && (
                <ConfirmModal
                    message={confirmModal.message}
                    confirmLabel="휴지통으로 이동"
                    danger
                    onConfirm={confirmModal.onConfirm}
                    onCancel={() => setConfirmModal(null)}
                />
            )}
        </div>
    );
}
