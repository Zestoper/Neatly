import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { getEmailFilters } from "../api/emailFilters";
import { getDocuments, moveDocumentToFolder } from "../api/documents";
import { syncEmails, getSyncStatus, markEmailsViewed } from "../api/emailSync";
import { trashEmail } from "../api/emails";
import { useRefresh } from "../context/RefreshContext";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "../components/ConfirmModal";
import styles from "./Emails.module.css";

type Email = {
    id: string;
    subject: string;
    from_: string;
    date: string;
    is_unread: boolean;
};

type EmailDoc = {
    id: string;
    title: string;
    raw_text: string;
    raw_html: string | null;
    created_at: string;
    folder_id: string | null;
    sender: string | null;  // 이메일 변환 시 저장된 발신자 주소
};

export default function Emails() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { refreshKey, bump } = useRefresh();
    const { showToast } = useToast();

    const senderFilter = searchParams.get("sender");
    const folderParam  = searchParams.get("folder");
    // label 파라미터 — 사이드바의 "스팸" 링크가 ?label=SPAM 으로 넘어옴, 없으면 INBOX
    const label = (searchParams.get("label") ?? "INBOX").toUpperCase();

    const [emails, setEmails] = useState<Email[]>([]);
    const [loading, setLoading] = useState(true);
    const [connected, setConnected] = useState(false);

    const [folderDocs, setFolderDocs] = useState<EmailDoc[]>([]);
    const [folderLoading, setFolderLoading] = useState(false);
    const [query, setQuery] = useState("");
    const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
    // sortOrder : 폴더 모드 정렬 — "newest"(최신순) | "oldest"(오래된순)
    const plan = localStorage.getItem("plan") ?? "FREE";
    const canConvert = plan === "STANDARD" || plan === "PREMIUM";
    const isPremium = plan === "PREMIUM";

    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void; confirmLabel?: string } | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    // syncing : 동기화 요청 진행 중 여부 — true이면 버튼 비활성화
    const [lastSync, setLastSync] = useState<string | null>(null);
    // lastSync : 마지막 동기화 시각 ISO 문자열 — null이면 한 번도 동기화 안 됨

    const [blockedSenders, setBlockedSenders] = useState<string[]>([]);
    // blockedSenders : 스팸으로 처리된 발신자 목록 — INBOX에서 해당 발신자 이메일을 숨김

    // 폴더 선택 시 해당 폴더의 이메일 출처 문서 로드
    useEffect(() => {
        if (!folderParam) return;
        setFolderLoading(true);
        getDocuments()
            .then((all: EmailDoc[]) => {
                const docs = all
                    .filter((d) => d.raw_html !== null && d.folder_id === folderParam)
                    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1)); // 최신순
                setFolderDocs(docs);
            })
            .finally(() => setFolderLoading(false));
    }, [folderParam, refreshKey]);

    // label(메일함) 또는 senderFilter가 바뀔 때마다 재요청 — 폴더 모드에서는 스킵
    useEffect(() => {
        if (folderParam) return;
        fetchEmails(label);
    }, [label, folderParam, refreshKey]);

    useEffect(() => {
        if (searchParams.get("connected") === "true") {
            fetchEmails(label);
        }
    }, [searchParams]);

    // 차단된 발신자 목록 로드 — INBOX에서 스팸 처리된 발신자 이메일을 숨기는 데 사용
    useEffect(() => {
        getEmailFilters()
            .then((filters) => setBlockedSenders(filters.map((f) => f.sender)))
            .catch(() => {});
    }, []);

    // Premium 플랜이면 마지막 동기화 시각 로드 + 뱃지 초기화
    useEffect(() => {
        if (!isPremium) return;
        getSyncStatus()
            .then((data) => setLastSync(data.last_sync ?? null))
            .catch(() => {});
        // 페이지 진입 시 "읽었음" 기록 → 사이드바 뱃지 카운트 초기화
        markEmailsViewed().catch(() => {});
    }, [isPremium]);

    const handleTrashEmail = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setConfirmModal({
            message: "이 이메일을 Gmail 휴지통으로 이동할까요?",
            confirmLabel: "이동",
            onConfirm: async () => {
                setConfirmModal(null);
                setDeletingId(id);
                try {
                    await trashEmail(id);
                    bump();
                } catch {
                    showToast("이메일 삭제에 실패했습니다. 다시 시도해주세요.");
                } finally {
                    setDeletingId(null);
                }
            },
        });
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            const res = await syncEmails();
            setLastSync(res.last_sync ?? null);
            await fetchEmails(label);
            showToast(res.synced > 0 ? `새 이메일 ${res.synced}개 동기화됐습니다.` : "새 이메일이 없습니다.");
        } catch (err: any) {
            showToast(err.response?.data?.detail ?? "동기화에 실패했습니다.");
        } finally {
            setSyncing(false);
        }
    };

    const fetchEmails = async (mailboxLabel: string) => {
        setLoading(true);
        try {
            const res = await api.get("/emails", { params: { label: mailboxLabel } });
            setEmails(res.data);
            setConnected(true);
        } catch (error: any) {
            if (error.response?.status === 400) {
                setConnected(false);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleConnect = async () => {
        const res = await api.get("/auth/gmail");
        window.location.href = res.data.url;
    };

    const handleDeleteDoc = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setConfirmModal({
            message: "이 문서를 폴더에서 제거할까요?",
            confirmLabel: "제거",
            onConfirm: async () => {
                setConfirmModal(null);
                await moveDocumentToFolder(id, null);
                bump();
            },
        });
    };

    // ── 폴더 모드 ───────────────────────────────────────────────────
    if (folderParam) {
        const filtered = folderDocs
            .filter((d) => !query || d.title.includes(query) || d.raw_text?.includes(query))
            .sort((a, b) => {
                const cmp = a.created_at > b.created_at ? -1 : 1;
                return sortOrder === "newest" ? cmp : -cmp;
            });

        return (
            <div className={styles.container}>
                <h1 className={styles.heading}>폴더</h1>

                {/* 검색 + 정렬 툴바 */}
                <div className={styles.folderToolbar}>
                    <input
                        className={styles.searchInput}
                        placeholder="제목, 본문 검색"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                        className={sortOrder === "newest" ? styles.sortButtonActive : styles.sortButton}
                        onClick={() => setSortOrder("newest")}
                    >
                        최신순
                    </button>
                    <button
                        className={sortOrder === "oldest" ? styles.sortButtonActive : styles.sortButton}
                        onClick={() => setSortOrder("oldest")}
                    >
                        오래된순
                    </button>
                </div>


                {folderLoading ? (
                    <p>불러오는 중...</p>
                ) : (
                    <div className={styles.list}>
                        {filtered.length === 0 ? (
                            <p className={styles.empty}>이메일이 없습니다.</p>
                        ) : (
                            filtered.map((doc) => (
                                <div
                                    key={doc.id}
                                    className={styles.emailRow}
                                    onClick={() => navigate(`/documents/${doc.id}`)}
                                >
                                    <div className={styles.emailInfo}>
                                        <p className={styles.subject}>{doc.title}</p>
                                        <p className={styles.meta}>
                                            {doc.sender && (
                                                <span className={styles.senderMeta}>
                                                    {doc.sender.includes("<")
                                                        ? doc.sender.slice(0, doc.sender.indexOf("<")).trim() || doc.sender
                                                        : doc.sender}
                                                    {" · "}
                                                </span>
                                            )}
                                            {new Date(doc.created_at).toLocaleDateString("ko-KR", {
                                                month: "long", day: "numeric",
                                            })}
                                        </p>
                                    </div>
                                    <button
                                        className={styles.rowDeleteBtn}
                                        onClick={(e) => handleDeleteDoc(e, doc.id)}
                                        title="삭제"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
            {confirmModal && (
                <ConfirmModal
                    message={confirmModal.message}
                    confirmLabel={confirmModal.confirmLabel ?? "확인"}
                    danger
                    onConfirm={confirmModal.onConfirm}
                    onCancel={() => setConfirmModal(null)}
                />
            )}
        </div>
        );
    }

    // ── Gmail 모드 ───────────────────────────────────────────────────
    if (loading) return <p>불러오는 중...</p>;

    if (!connected) {
        return (
            <div className={styles.container}>
                <h1 className={styles.heading}>Emails</h1>
                <div className={styles.gateBox}>
                    <p className={styles.gateText}>
                        Gmail을 연결하면 이메일을 자동으로 문서로 정리할 수 있어요.
                    </p>
                    <button className={styles.connectButton} onClick={handleConnect}>
                        Gmail 연결하기
                    </button>
                </div>
            </div>
        );
    }

    // "John Doe <john@example.com>" → "john@example.com", 꺽쇠 없으면 그대로
    const extractEmail = (s: string) =>
        s.match(/<(.+?)>/)?.[1]?.toLowerCase() ?? s.toLowerCase().trim();

    // INBOX일 때 : 스팸 처리된 발신자 제외 → senderFilter(사이드바 클릭) 적용
    // SPAM일 때 : 차단 필터 적용 안 함 — 스팸함이므로 그대로 표시
    const displayedEmails = (() => {
        let result = emails;
        if (label === "INBOX" && blockedSenders.length > 0) {
            result = result.filter(
                (e) => !blockedSenders.some((blocked) =>
                    extractEmail(e.from_) === extractEmail(blocked)
                )
            );
        }
        if (senderFilter) {
            result = result.filter((e) => e.from_.includes(senderFilter));
        }
        if (query) {
            result = result.filter(
                (e) => e.subject.includes(query) || e.from_.includes(query)
            );
        }
        return result;
    })();

    const isSpam = label === "SPAM";

    return (
        <div className={styles.container}>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.heading}>{isSpam ? "스팸" : "Emails"}</h1>
                    <p className={styles.subheading}>
                        {isSpam ? "스팸으로 표시된 이메일" : `최근 이메일 ${emails.length}개`}
                    </p>
                </div>
                {/* Premium 플랜이고 INBOX일 때만 동기화 버튼 표시 */}
                {isPremium && !isSpam && (
                    <div className={styles.syncArea}>
                        {lastSync && (
                            <span className={styles.lastSyncText}>
                                마지막 동기화 {new Date(lastSync).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                        )}
                        <button
                            className={styles.syncButton}
                            onClick={handleSync}
                            disabled={syncing}
                        >
                            {syncing ? "동기화 중..." : "지금 동기화"}
                        </button>
                    </div>
                )}
            </div>
            <input
                className={styles.searchInput}
                placeholder="제목, 발신자 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />

            {!canConvert && !isSpam && (
                <div className={styles.upgradeBanner}>
                    <p className={styles.upgradeBannerText}>
                        문서 변환 및 AI 요약은 Standard 플랜부터 사용할 수 있습니다.
                    </p>
                    <button
                        className={styles.upgradeBannerButton}
                        onClick={() => navigate("/plans")}
                    >
                        업그레이드
                    </button>
                </div>
            )}

            <div className={styles.list}>
                {displayedEmails.length === 0 ? (
                    <p className={styles.empty}>
                        {isSpam ? "스팸 메일이 없습니다." : "이메일이 없습니다."}
                    </p>
                ) : (
                    displayedEmails.map((email) => (
                        <div
                            key={email.id}
                            className={email.is_unread ? styles.emailRowUnread : styles.emailRow}
                            onClick={() => navigate(`/emails/${email.id}`)}
                            draggable
                            onDragStart={(e) => {
                                // "email:" 접두사로 사이드바에서 문서 드래그와 구분
                                e.dataTransfer.setData("text/plain", `email:${email.id}`);
                                e.dataTransfer.effectAllowed = "move";

                                // 이메일 제목만 담은 작은 ghost — 기본 ghost(행 전체)보다 가볍게 표시
                                const ghost = document.createElement("div");
                                ghost.textContent = email.subject;
                                ghost.className = styles.dragGhost;
                                document.body.appendChild(ghost);
                                e.dataTransfer.setDragImage(ghost, 0, 0);
                                // 브라우저가 ghost를 캡처한 직후 DOM에서 제거
                                setTimeout(() => document.body.removeChild(ghost), 0);
                            }}
                        >
                            <div className={styles.emailInfo}>
                                <p className={email.is_unread ? styles.subjectUnread : styles.subject}>
                                    {email.subject}
                                </p>
                                <p className={styles.meta}>
                                    {email.from_} · {email.date}
                                </p>
                            </div>
                            <button
                                className={styles.rowDeleteBtn}
                                onClick={(e) => handleTrashEmail(e, email.id)}
                                disabled={deletingId === email.id}
                                title="휴지통으로 이동"
                            >
                                {deletingId === email.id ? "..." : "✕"}
                            </button>
                        </div>
                    ))
                )}
            </div>
            {confirmModal && (
                <ConfirmModal
                    message={confirmModal.message}
                    confirmLabel={confirmModal.confirmLabel ?? "확인"}
                    danger
                    onConfirm={confirmModal.onConfirm}
                    onCancel={() => setConfirmModal(null)}
                />
            )}
        </div>
    );
}
