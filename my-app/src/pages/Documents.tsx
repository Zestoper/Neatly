import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getDocuments, uploadDocument, deleteDocument, moveDocumentToFolder } from "../api/documents";
import { useRefresh } from "../context/RefreshContext";
import ConfirmModal from "../components/ConfirmModal";
import styles from "./Documents.module.css";

type Tag = {
    id: string;
    name: string;
};

type Document = {
    id: string;
    title: string;
    raw_text: string;
    raw_html: string | null;  // raw_html : 이메일 출처 문서에만 존재 — null이면 일반 문서
    created_at: string;
    folder_id: string | null; // folder_id : 속한 폴더 ID, 없으면 null
    tags: Tag[];              // tags : 이 문서에 달린 태그 목록
};

export default function Documents() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const folderFilter = searchParams.get("folder");
    const { refreshKey, bump } = useRefresh();
    // searchParams.get("folder") : URL이 /documents?folder=abc 이면 "abc" 반환, 없으면 null

    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    // selectedTag : 클릭된 태그 이름. null이면 태그 필터 없음

    const [cardDragId, setCardDragId] = useState<string | null>(null);
    // cardDragId : 순서 변경 드래그 중인 카드 ID — null이면 순서 변경 모드 아님
    const [cardDragOverId, setCardDragOverId] = useState<string | null>(null);
    // cardDragOverId : 드래그 중 커서가 올라온 카드 ID — 드롭 위치 선 표시에 사용
    const [manualOrder, setManualOrder] = useState<Record<string, string[]>>({});
    const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");

    const [uploading, setUploading] = useState(false);
    // uploading : 파일 업로드 + AI 요약 중 여부 — true이면 드롭존 비활성화
    const [uploadError, setUploadError] = useState<string | null>(null);
    // uploadError : 업로드 실패 메시지 — null이면 에러 없음
    const [fileDragOver, setFileDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void; confirmLabel?: string } | null>(null);
    // fileDragOver : 파일을 드롭존 위에 드래그 중일 때 true — 강조 스타일 적용

    // orderKey : 현재 뷰에 해당하는 localStorage 키
    const orderKey = `cardOrder-${folderFilter ?? "root"}`;

    useEffect(() => {
        setLoading(true);
        getDocuments()
            .then((data) => setDocuments(data))
            .finally(() => setLoading(false));
    }, [refreshKey]);

    // 폴더(뷰)가 바뀔 때마다 해당 뷰의 저장된 순서 로드
    useEffect(() => {
        const saved = localStorage.getItem(orderKey);
        if (saved) {
            setManualOrder((prev) => ({ ...prev, [orderKey]: JSON.parse(saved) }));
        }
    }, [folderFilter]);

    // 모든 문서에서 태그를 모아 중복 제거 — 태그 필터 칩 목록에 사용
    const allTags: Tag[] = Array.from(
        new Map(
            documents.flatMap((doc) => doc.tags).map((tag) => [tag.id, tag])
        ).values()
    );
    // flatMap : 각 문서의 tags 배열을 하나로 합침
    // Map(id → tag) : 같은 id의 태그가 여러 문서에 달려도 한 번만 남김
    // Array.from(...values()) : Map의 값만 다시 배열로 변환

    // 폴더가 선택된 경우 : 해당 폴더 문서만 (이메일 출처 포함)
    // 폴더 미선택 : 이메일 드래그로 생성된 문서(raw_html 존재)는 숨김 — 이메일은 Emails에서 관리
    const folderFiltered = folderFilter
        ? documents.filter((doc) => doc.folder_id === folderFilter)
        : documents.filter((doc) => !doc.raw_html);

    // 태그 필터가 선택됐으면 해당 태그가 달린 문서만
    const tagFiltered = selectedTag
        ? folderFiltered.filter((doc) =>
            doc.tags.some((tag) => tag.name === selectedTag)
          )
        : folderFiltered;
    // some : 배열 안에 조건에 맞는 항목이 하나라도 있으면 true

    // 텍스트 검색 — 제목, 본문, 태그 이름 모두 포함
    const filtered = query.trim()
        ? tagFiltered.filter((doc) =>
            doc.title.includes(query) ||
            doc.raw_text.includes(query) ||
            doc.tags.some((tag) => tag.name.includes(query))
          )
        : tagFiltered;

    const sorted = filtered.slice().sort((a, b) => {
        if (sortOrder === "name") return a.title.localeCompare(b.title, "ko");
        if (sortOrder === "oldest") return a.created_at > b.created_at ? 1 : -1;
        return a.created_at > b.created_at ? -1 : 1;
    });

    // 수동 순서가 있으면 sorted 대신 그 순서로 표시
    const savedOrder = manualOrder[orderKey] ?? [];
    const displayedCards = savedOrder.length > 0
        ? [...sorted].sort((a, b) => {
            const ai = savedOrder.indexOf(a.id);
            const bi = savedOrder.indexOf(b.id);
            if (ai === -1) return 1;   // 새 문서는 맨 뒤
            if (bi === -1) return -1;
            return ai - bi;
        })
        : sorted;

    const handleCardReorder = (draggedId: string, targetId: string) => {
        if (draggedId === targetId) return;
        const list = [...displayedCards];
        const fromIdx = list.findIndex((d) => d.id === draggedId);
        const toIdx   = list.findIndex((d) => d.id === targetId);
        const [moved] = list.splice(fromIdx, 1);
        list.splice(toIdx, 0, moved);
        const newOrder = list.map((d) => d.id);
        setManualOrder((prev) => ({ ...prev, [orderKey]: newOrder }));
        localStorage.setItem(orderKey, JSON.stringify(newOrder));
    };

    const handleDeleteCard = (e: React.MouseEvent, docId: string) => {
        e.stopPropagation();
        if (folderFilter) {
            setConfirmModal({
                message: "이 문서를 폴더에서 제거할까요?",
                confirmLabel: "제거",
                onConfirm: async () => {
                    setConfirmModal(null);
                    await moveDocumentToFolder(docId, null);
                    bump();
                },
            });
        } else {
            setConfirmModal({
                message: "이 문서를 휴지통으로 이동할까요?",
                confirmLabel: "휴지통으로 이동",
                onConfirm: async () => {
                    setConfirmModal(null);
                    await deleteDocument(docId);
                    bump();
                },
            });
        }
    };

    // 파일 하나를 받아 업로드 + AI 요약 → 목록 맨 앞에 추가
    const processFile = async (file: File) => {
        const allowed = ["pdf", "docx", "txt", "md"];
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!allowed.includes(ext)) {
            // 허용되지 않은 확장자는 즉시 에러 표시 — 서버 요청 없이 처리
            setUploadError(`지원하지 않는 형식입니다. (PDF, DOCX, TXT, MD만 가능)`);
            return;
        }
        setUploadError(null);
        setUploading(true);
        try {
            await uploadDocument(file, folderFilter);
            bump();
        } catch (err: any) {
            setUploadError(err.response?.data?.detail ?? "업로드 중 오류가 발생했습니다.");
        } finally {
            setUploading(false);
        }
    };

    // 파일 input 변경 시 — 클릭해서 파일 선택한 경우
    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await processFile(file);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // 드롭존에 파일을 드래그해서 올렸을 때
    const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        setFileDragOver(false);
        if (uploading) return;
        const file = e.dataTransfer.files[0];
        if (file) await processFile(file);
    };

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });

    if (loading) return <p>불러오는 중...</p>;

    return (
        <div>
            <h1 className={styles.pageTitle}>Documents</h1>

            <div className={styles.toolbar}>
                <input
                    className={styles.searchInput}
                    placeholder="제목, 본문, 태그 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <div className={styles.sortGroup}>
                    {(["newest", "oldest", "name"] as const).map((opt) => (
                        <button
                            key={opt}
                            className={sortOrder === opt ? styles.sortButtonActive : styles.sortButton}
                            onClick={() => setSortOrder(opt)}
                        >
                            {opt === "newest" ? "최신순" : opt === "oldest" ? "오래된순" : "이름순"}
                        </button>
                    ))}
                </div>
            </div>

            {/* 숨긴 파일 input — label 클릭 또는 드래그 앤 드롭 시 트리거 */}
            <input
                ref={fileInputRef}
                id="file-upload"
                type="file"
                accept=".pdf,.docx,.txt,.md"
                style={{ display: "none" }}
                onChange={handleFileInputChange}
            />

            {/* 드래그 앤 드롭 업로드 영역 — 클릭하거나 파일을 끌어다 놓을 수 있음 */}
            <label
                htmlFor={uploading ? undefined : "file-upload"}
                className={
                    uploading
                        ? styles.uploadZoneLoading
                        : fileDragOver
                        ? styles.uploadZoneDragOver
                        : styles.uploadZone
                }
                onDragOver={(e) => {
                    // 드래그 중인 것이 파일일 때만 드롭 허용
                    if (e.dataTransfer.types.includes("Files")) {
                        e.preventDefault();
                        setFileDragOver(true);
                    }
                }}
                onDragLeave={() => setFileDragOver(false)}
                onDrop={handleDrop}
            >
                {uploading ? (
                    // 업로드·요약 진행 중 상태
                    <span className={styles.uploadZoneStatus}>AI 요약 중...</span>
                ) : (
                    <>
                        <span className={styles.uploadZoneMain}>
                            클릭하거나 파일을 여기에 끌어다 놓으세요
                        </span>
                        <span className={styles.uploadZoneSub}>
                            PDF · DOCX · TXT · MD
                        </span>
                    </>
                )}
            </label>

            {/* 업로드 실패 시 인라인 에러 메시지 */}
            {uploadError && (
                <p className={styles.uploadError}>{uploadError}</p>
            )}

            {/* 태그 필터 칩 목록 — 태그가 하나라도 있을 때만 표시 */}
            {allTags.length > 0 && (
                <div className={styles.tagFilterRow}>
                    {allTags.map((tag) => (
                        <button
                            key={tag.id}
                            className={
                                selectedTag === tag.name
                                    ? styles.tagFilterActive   // 선택된 태그
                                    : styles.tagFilterChip     // 선택 안 된 태그
                            }
                            onClick={() =>
                                // 이미 선택된 태그를 다시 클릭하면 해제, 아니면 선택
                                setSelectedTag(selectedTag === tag.name ? null : tag.name)
                            }
                        >
                            {tag.name}
                        </button>
                    ))}
                    {/* 태그 필터가 선택된 상태일 때만 해제 버튼 표시 */}
                    {selectedTag && (
                        <button
                            className={styles.tagFilterClear}
                            onClick={() => setSelectedTag(null)}
                        >
                            필터 해제
                        </button>
                    )}
                </div>
            )}

            <div className={styles.list}>
                {displayedCards.length === 0 ? (
                    <p>{query || selectedTag ? "검색 결과가 없습니다." : "문서가 없습니다."}</p>
                ) : (
                    displayedCards.map((doc) => (
                        <div
                            key={doc.id}
                            className={cardDragOverId === doc.id ? styles.cardDragOver : styles.card}
                            onClick={() => navigate(`/documents/${doc.id}`, { state: { fromFolder: folderFilter } })}
                            draggable
                            onDragStart={(e) => {
                                // 카드 바디 드래그 — 사이드바 폴더로 이동
                                e.dataTransfer.setData("text/plain", doc.id);
                                e.dataTransfer.effectAllowed = "move";

                                const ghost = document.createElement("div");
                                ghost.textContent = doc.title;
                                ghost.className = styles.dragGhost;
                                document.body.appendChild(ghost);
                                e.dataTransfer.setDragImage(ghost, 0, 0);
                                setTimeout(() => document.body.removeChild(ghost), 0);
                            }}
                            onDragOver={(e) => {
                                // 카드 순서 변경 드래그 중일 때만 드롭 위치 표시
                                if (!cardDragId) return;
                                e.preventDefault();
                                setCardDragOverId(doc.id);
                            }}
                            onDragLeave={() => setCardDragOverId(null)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setCardDragOverId(null);
                                const data = e.dataTransfer.getData("text/plain").trim();
                                if (data.startsWith("card-reorder:")) {
                                    handleCardReorder(data.slice("card-reorder:".length), doc.id);
                                }
                            }}
                        >
                            <div className={styles.cardRow}>
                                {/* 드래그 핸들 — 호버 시 표시, 잡아서 드래그하면 순서 변경 */}
                                <div
                                    className={styles.cardDragHandle}
                                    draggable
                                    onDragStart={(e) => {
                                        e.stopPropagation();
                                        setCardDragId(doc.id);
                                        e.dataTransfer.setData("text/plain", `card-reorder:${doc.id}`);
                                        e.dataTransfer.effectAllowed = "move";
                                    }}
                                    onDragEnd={() => {
                                        setCardDragId(null);
                                        setCardDragOverId(null);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    &#9776;
                                </div>
                                <div className={styles.cardBody}>
                                    <div className={styles.cardHeader}>
                                        <p className={styles.cardTitle}>{doc.title}</p>
                                        <div className={styles.cardHeaderRight}>
                                            <p className={styles.cardDate}>{formatDate(doc.created_at)}</p>
                                            <button
                                                className={styles.cardDeleteBtn}
                                                onClick={(e) => handleDeleteCard(e, doc.id)}
                                                title="삭제"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    </div>
                                    <p className={styles.cardContent}>{doc.raw_text}</p>
                                    {doc.tags.length > 0 && (
                                        <div className={styles.cardTagList}>
                                            {doc.tags.map((tag) => (
                                                <span
                                                    key={tag.id}
                                                    className={
                                                        selectedTag === tag.name
                                                            ? styles.cardTagBadgeActive
                                                            : styles.cardTagBadge
                                                    }
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedTag(selectedTag === tag.name ? null : tag.name);
                                                    }}
                                                >
                                                    {tag.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
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
