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
    raw_html: string | null;
    created_at: string;
    folder_id: string | null;
    tags: Tag[];
};

export default function Documents() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const folderFilter = searchParams.get("folder");
    const { refreshKey, bump } = useRefresh();

    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [selectedTag, setSelectedTag] = useState<string | null>(null);

    const [cardDragId, setCardDragId] = useState<string | null>(null);

    const [cardDragOverId, setCardDragOverId] = useState<string | null>(null);

    const [manualOrder, setManualOrder] = useState<Record<string, string[]>>({});
    const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");

    const [uploading, setUploading] = useState(false);

    const [uploadError, setUploadError] = useState<string | null>(null);

    const [fileDragOver, setFileDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void; confirmLabel?: string } | null>(null);

    const orderKey = `cardOrder-${folderFilter ?? "root"}`;

    useEffect(() => {
        setLoading(true);
        getDocuments()
            .then((data) => setDocuments(data))
            .finally(() => setLoading(false));
    }, [refreshKey]);

    useEffect(() => {
        const saved = localStorage.getItem(orderKey);
        if (saved) {
            setManualOrder((prev) => ({ ...prev, [orderKey]: JSON.parse(saved) }));
        }
    }, [folderFilter]);

    const allTags: Tag[] = Array.from(
        new Map(
            documents.flatMap((doc) => doc.tags).map((tag) => [tag.id, tag])
        ).values()
    );

    const folderFiltered = folderFilter
        ? documents.filter((doc) => doc.folder_id === folderFilter)
        : documents.filter((doc) => !doc.raw_html);

    const tagFiltered = selectedTag
        ? folderFiltered.filter((doc) =>
            doc.tags.some((tag) => tag.name === selectedTag)
          )
        : folderFiltered;

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

    const savedOrder = manualOrder[orderKey] ?? [];
    const displayedCards = savedOrder.length > 0
        ? [...sorted].sort((a, b) => {
            const ai = savedOrder.indexOf(a.id);
            const bi = savedOrder.indexOf(b.id);
            if (ai === -1) return 1;
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

    const processFile = async (file: File) => {
        const allowed = ["pdf", "docx", "txt", "md"];
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!allowed.includes(ext)) {

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

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await processFile(file);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

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

            <input
                ref={fileInputRef}
                id="file-upload"
                type="file"
                accept=".pdf,.docx,.txt,.md"
                style={{ display: "none" }}
                onChange={handleFileInputChange}
            />

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

                    if (e.dataTransfer.types.includes("Files")) {
                        e.preventDefault();
                        setFileDragOver(true);
                    }
                }}
                onDragLeave={() => setFileDragOver(false)}
                onDrop={handleDrop}
            >
                {uploading ? (

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

            {uploadError && (
                <p className={styles.uploadError}>{uploadError}</p>
            )}

            {allTags.length > 0 && (
                <div className={styles.tagFilterRow}>
                    {allTags.map((tag) => (
                        <button
                            key={tag.id}
                            className={
                                selectedTag === tag.name
                                    ? styles.tagFilterActive
                                    : styles.tagFilterChip
                            }
                            onClick={() =>

                                setSelectedTag(selectedTag === tag.name ? null : tag.name)
                            }
                        >
                            {tag.name}
                        </button>
                    ))}

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
