import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDocuments } from "../api/documents";
import { getFolders } from "../api/folders";
import { api } from "../api/client";
import { generateBriefing, getBriefingByDate } from "../api/briefing";
import { syncEmails, getSyncStatus } from "../api/emailSync";
import { useToast } from "../context/ToastContext";
import styles from "./Dashboard.module.css";

type Tag = {
    id: string;
    name: string;
};

type Document = {
    id: string;
    title: string;
    created_at: string;
    tags: Tag[];
};

type Folder = {
    id: string;
    name: string;
};

export default function Dashboard() {
    const navigate = useNavigate();
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [userName, setUserName] = useState<string | null>(null);
    const [folders, setFolders] = useState<Folder[]>([]);

    useEffect(() => {
        const token = localStorage.getItem("token");
        if (!token) window.location.href = "/login";
    }, []);

    useEffect(() => {
        const init = async () => {
            try {
                const [docsData, meData] = await Promise.all([
                    getDocuments(),
                    api.get("/auth/me"),
                ]);
                setDocuments(docsData);
                setUserName(meData.data.name ?? null);
                setGmailConnected(!!meData.data.gmail_access_token);
            } catch (error) {
                console.error("데이터 불러오기 실패", error);
            } finally {
                setLoading(false);
            }
        };
        init();
    }, []);

    const [gmailConnected, setGmailConnected] = useState(false);
    const [syncStatus, setSyncStatus] = useState<{ last_sync: string | null; new_count: number } | null>(null);
    const [syncingGmail, setSyncingGmail] = useState(false);

    const { showToast } = useToast();
    const plan = localStorage.getItem("plan") ?? "FREE";
    const isPremium = plan === "PREMIUM";

    const [briefing, setBriefing] = useState<{ id: string | null; title: string; content: string } | null>(null);
    const [briefingLoading, setBriefingLoading] = useState(false);
    const [selectedFolder, setSelectedFolder] = useState<string>("");
    const [selectedDate, setSelectedDate] = useState<string>(
        new Date().toLocaleDateString("en-CA") // YYYY-MM-DD (로컬 기준 오늘)
    );

    const todayStr = new Date().toLocaleDateString("en-CA");

    // Premium이면 전체 폴더 목록 로드
    useEffect(() => {
        if (!isPremium) return;
        getFolders()
            .then((data: Folder[]) => setFolders(data))
            .catch(() => {});
    }, [isPremium]);

    // 날짜/폴더 기반 브리핑 로드 헬퍼
    const loadBriefing = async (folderId: string, date: string) => {
        setBriefing(null);
        setBriefingLoading(true);
        try {
            if (folderId) {
                // 폴더 브리핑: 날짜 무관, 폴더 문서 전체 요약
                const data = await generateBriefing(folderId);
                setBriefing(data);
            } else {
                // 날짜 브리핑: 해당 날짜 기존 브리핑 조회 → 없으면 생성
                const existing = await getBriefingByDate(date);
                if (existing.briefing) {
                    setBriefing(existing.briefing);
                } else {
                    const generated = await generateBriefing(undefined, date);
                    setBriefing(generated);
                }
            }
        } catch {
            // 문서 없음 등 — 빈 상태 유지
        } finally {
            setBriefingLoading(false);
        }
    };

    // 마운트 시 오늘 브리핑 자동 로드
    useEffect(() => {
        if (!isPremium) return;
        loadBriefing("", todayStr);
    }, [isPremium]);

    // Gmail 동기화 상태 로드
    useEffect(() => {
        if (!isPremium) return;
        getSyncStatus()
            .then((data) => setSyncStatus(data))
            .catch(() => {});
    }, [isPremium]);

    const handleGmailSync = async () => {
        setSyncingGmail(true);
        try {
            const res = await syncEmails();
            setSyncStatus((prev) => ({ new_count: prev?.new_count ?? 0, last_sync: res.last_sync ?? null }));
        } catch {
            showToast("Gmail 동기화에 실패했습니다.");
        } finally {
            setSyncingGmail(false);
        }
    };

    const handleFolderChange = (folderId: string) => {
        setSelectedFolder(folderId);
        loadBriefing(folderId, selectedDate);
    };

    const handleDateChange = (date: string) => {
        setSelectedDate(date);
        if (!selectedFolder) loadBriefing("", date);
    };

    const handleRegenerateBriefing = async () => {
        setBriefingLoading(true);
        try {
            const data = await generateBriefing(selectedFolder || undefined, selectedFolder ? undefined : selectedDate);
            setBriefing(data);
        } catch {
            showToast("브리핑 생성에 실패했습니다.");
        } finally {
            setBriefingLoading(false);
        }
    };

    // 이번 주 문서 — 7일 이내 생성된 것만
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const thisWeekCount = documents.filter(
        (doc) => new Date(doc.created_at) >= oneWeekAgo
    ).length;

    // 전체 문서에서 중복 없는 태그 수
    const uniqueTagCount = new Set(
        documents.flatMap((doc) => doc.tags.map((t) => t.id))
    ).size;

    // 최근 3개 문서
    const recentDocs = documents
        .slice()
        .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
        .slice(0, 3);

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });

    if (loading) return <p>불러오는 중...</p>;

    return (
        <div className={styles.container}>

            {/* 상단 인사 + 플랜 배지 */}
            <div className={styles.header}>
                <h1 className={styles.greeting}>
                    안녕하세요{userName ? ` ${userName}님` : ""}.
                </h1>
                <span className={styles.planBadge}>{plan}</span>
            </div>

            {/* 통계 행 */}
            <div className={styles.statsRow}>
                <div className={styles.statCard}>
                    <p className={styles.statLabel}>전체 문서</p>
                    <p className={styles.statValue}>{documents.length}</p>
                </div>
                <div className={styles.statCard}>
                    <p className={styles.statLabel}>이번 주 추가</p>
                    <p className={styles.statValue}>{thisWeekCount}</p>
                </div>
                <div className={styles.statCard}>
                    <p className={styles.statLabel}>태그</p>
                    <p className={styles.statValue}>{uniqueTagCount}</p>
                </div>
            </div>

            {/* 최근 문서 */}
            {recentDocs.length > 0 && (
                <div className={styles.section}>
                    <p className={styles.sectionLabel}>최근 문서</p>
                    <div className={styles.recentList}>
                        {recentDocs.map((doc) => (
                            <div
                                key={doc.id}
                                className={styles.recentRow}
                                onClick={() => navigate(`/documents/${doc.id}`)}
                            >
                                <span className={styles.recentTitle}>{doc.title}</span>
                                <span className={styles.recentDate}>{formatDate(doc.created_at)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* AI 브리핑 섹션 */}
            <div className={styles.premiumCard}>
                <div className={styles.premiumCardHeader}>
                    <p className={styles.premiumCardTitle}>AI 브리핑</p>
                    <span className={styles.premiumBadge}>Premium</span>
                    {isPremium && (
                        <>
                            {!selectedFolder && (
                                <input
                                    type="date"
                                    className={styles.dateInput}
                                    value={selectedDate}
                                    max={todayStr}
                                    onChange={(e) => handleDateChange(e.target.value)}
                                    disabled={briefingLoading}
                                />
                            )}
                            <select
                                className={styles.folderSelect}
                                value={selectedFolder}
                                onChange={(e) => handleFolderChange(e.target.value)}
                                disabled={briefingLoading}
                            >
                                <option value="">전체</option>
                                {folders.map((f) => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                        </>
                    )}
                </div>
                <p className={styles.premiumCardDesc}>
                    문서와 이메일을 분석해 오늘의 핵심 내용을 요약하고 할 일을 추천합니다.
                </p>

                {isPremium ? (
                    briefingLoading ? (
                        <p className={styles.briefingLoading}>브리핑 생성 중...</p>
                    ) : briefing ? (
                        <div className={styles.briefingContent}>
                            <p className={styles.briefingText}>{briefing.content}</p>
                            <button
                                className={styles.upgradeButtonOutline}
                                onClick={handleRegenerateBriefing}
                            >
                                다시 생성
                            </button>
                        </div>
                    ) : (
                        <p className={styles.briefingEmpty}>
                            {selectedFolder ? "해당 폴더에 문서가 없습니다." : "오늘 추가된 문서가 없어 브리핑을 생성할 수 없습니다."}
                        </p>
                    )
                ) : (
                    /* Non-premium: 블러 미리보기 + 업그레이드 유도 */
                    <div className={styles.premiumPreview}>
                        <p className={styles.premiumPreviewText}>
                            오늘 추가된 문서 3건을 분석했습니다. 주요 키워드는 계약, 일정, 피드백입니다.
                            가장 시급한 항목은 "클라이언트 미팅 준비"로 보입니다.
                        </p>
                        <div className={styles.premiumOverlay}>
                            <p className={styles.premiumOverlayText}>Premium 플랜에서 사용할 수 있어요.</p>
                            <button className={styles.upgradeButton} onClick={() => navigate("/plans")}>
                                업그레이드
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Gmail 자동 분류 섹션 */}
            <div className={styles.premiumCard}>
                <div className={styles.premiumCardHeader}>
                    <p className={styles.premiumCardTitle}>Gmail 자동 분류</p>
                    <span className={styles.premiumBadge}>Premium</span>
                    {isPremium && gmailConnected && syncStatus?.last_sync && (
                        <span className={styles.syncMeta}>
                            마지막 동기화 {new Date(syncStatus.last_sync).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                    )}
                </div>
                <p className={styles.premiumCardDesc}>
                    이메일이 도착하면 자동으로 요약해 문서로 변환하고, 폴더와 태그를 달아 정리합니다.
                </p>

                <div className={styles.featureList}>
                    {[
                        "실시간 이메일 수신 감지",
                        "AI 자동 요약 및 문서 변환",
                        "폴더·태그 자동 분류",
                    ].map((item) => (
                        <div key={item} className={isPremium ? styles.featureItem : styles.featureItemLocked}>
                            <span className={styles.featureDot} />
                            <span>{item}</span>
                        </div>
                    ))}
                </div>

                {isPremium ? (
                    gmailConnected ? (
                        <div className={styles.gmailSyncRow}>
                            {syncStatus?.new_count ? (
                                <span className={styles.newEmailBadge}>새 이메일 {syncStatus.new_count}개</span>
                            ) : null}
                            <button
                                className={styles.upgradeButtonOutline}
                                onClick={handleGmailSync}
                                disabled={syncingGmail}
                            >
                                {syncingGmail ? "동기화 중..." : "지금 동기화"}
                            </button>
                        </div>
                    ) : (
                        <button className={styles.upgradeButtonOutline} onClick={() => navigate("/settings")}>
                            Gmail 연결하기
                        </button>
                    )
                ) : (
                    <button className={styles.upgradeButtonOutline} onClick={() => navigate("/plans")}>
                        업그레이드
                    </button>
                )}
            </div>

        </div>
    );
}
