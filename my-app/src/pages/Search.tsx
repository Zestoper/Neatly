import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { searchDocuments } from "../api/search";
import { getDocuments } from "../api/documents";
import { useToast } from "../context/ToastContext";
import styles from "./Search.module.css";

type Tag = {
    id: string;
    name: string;
};

type SearchResult = {
    id: string;
    title: string;
    raw_text: string;
    summary: string | null;
    raw_html: string | null;
    sender: string | null;
    created_at: string;
    folder_id: string | null;
    tags: Tag[];
};

export default function Search() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { showToast } = useToast();

    // URL의 ?q= 파라미터를 초기값으로 사용 — 링크 공유·뒤로가기 시 검색어 유지
    const initialQuery = searchParams.get("q") ?? "";
    const [query, setQuery] = useState(initialQuery);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [allDocs, setAllDocs] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);

    // 페이지 진입 시 검색창에 포커스 + 전체 문서 최신순 로드
    useEffect(() => {
        inputRef.current?.focus();
        getDocuments()
            .then((data: SearchResult[]) =>
                setAllDocs(data.slice().sort((a, b) => (a.created_at > b.created_at ? -1 : 1)))
            )
            .catch(() => showToast("문서 목록을 불러오지 못했습니다."));
    }, []);

    // URL에 q가 있으면 자동으로 검색 실행
    useEffect(() => {
        if (initialQuery) {
            runSearch(initialQuery);
        }
    }, []);

    const runSearch = async (q: string) => {
        const trimmed = q.trim();
        if (!trimmed) {
            setResults([]);
            setSearched(false);
            setSearchParams({}, { replace: true });
            return;
        }
        setLoading(true);
        setSearched(true);
        // URL 쿼리스트링 동기화 — 뒤로가기 시 검색어 복원 가능
        setSearchParams({ q: trimmed }, { replace: true });
        try {
            const data = await searchDocuments(trimmed);
            setResults(data);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") runSearch(query);
        if (e.key === "Escape") {
            setQuery("");
            setResults([]);
            setSearched(false);
            setSearchParams({}, { replace: true });
        }
    };

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });

    // 검색어를 결과 텍스트에서 강조 표시
    const highlight = (text: string) => {
        if (!query.trim()) return text;
        const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const parts = text.split(new RegExp(`(${escaped})`, "gi"));
        return parts.map((part, i) =>
            part.toLowerCase() === query.trim().toLowerCase()
                ? <mark key={i} className={styles.highlight}>{part}</mark>
                : part
        );
    };

    return (
        <div className={styles.container}>
            <h1 className={styles.heading}>검색</h1>

            {/* 검색 입력창 */}
            <div className={styles.searchBar}>
                <input
                    ref={inputRef}
                    className={styles.searchInput}
                    placeholder="제목, 본문, 요약, 태그 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <button
                    className={styles.searchButton}
                    onClick={() => runSearch(query)}
                    disabled={loading}
                >
                    {loading ? "..." : "검색"}
                </button>
            </div>

            {/* 상태 메시지 */}
            {searched && !loading && (
                <p className={styles.resultCount}>
                    {results.length > 0
                        ? `${results.length}개의 문서를 찾았습니다.`
                        : "검색 결과가 없습니다."}
                </p>
            )}

            {/* 검색 결과 목록 — 검색어 없으면 전체 최신순 */}
            <div className={styles.list}>
                {(searched ? results : allDocs).map((doc) => (
                    <div
                        key={doc.id}
                        className={styles.resultCard}
                        onClick={() => navigate(`/documents/${doc.id}`)}
                    >
                        <div className={styles.cardHeader}>
                            <p className={styles.cardTitle}>{highlight(doc.title)}</p>
                            <p className={styles.cardDate}>{formatDate(doc.created_at)}</p>
                        </div>

                        {/* 요약이 있으면 요약, 없으면 본문 앞부분 표시 */}
                        <p className={styles.cardSnippet}>
                            {highlight((doc.summary || doc.raw_text).slice(0, 200))}
                        </p>

                        {/* 태그 목록 */}
                        {doc.tags.length > 0 && (
                            <div className={styles.tagRow}>
                                {doc.tags.map((tag) => (
                                    <span key={tag.id} className={styles.tagBadge}>
                                        {tag.name}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* 이메일 발신자 표시 */}
                        {doc.sender && (
                            <p className={styles.senderMeta}>
                                {highlight(doc.sender.includes("<")
                                    ? doc.sender.slice(0, doc.sender.indexOf("<")).trim() || doc.sender
                                    : doc.sender)}
                            </p>
                        )}

                        {/* 이메일 출처 표시 */}
                        {doc.raw_html && (
                            <span className={styles.emailBadge}>이메일</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
