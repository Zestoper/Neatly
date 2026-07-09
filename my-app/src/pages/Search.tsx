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

    const initialQuery = searchParams.get("q") ?? "";
    const [query, setQuery] = useState(initialQuery);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [allDocs, setAllDocs] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        getDocuments()
            .then((data: SearchResult[]) =>
                setAllDocs(data.slice().sort((a, b) => (a.created_at > b.created_at ? -1 : 1)))
            )
            .catch(() => showToast("문서 목록을 불러오지 못했습니다."));
    }, []);

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

            {searched && !loading && (
                <p className={styles.resultCount}>
                    {results.length > 0
                        ? `${results.length}개의 문서를 찾았습니다.`
                        : "검색 결과가 없습니다."}
                </p>
            )}

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

                        <p className={styles.cardSnippet}>
                            {highlight((doc.summary || doc.raw_text).slice(0, 200))}
                        </p>

                        {doc.tags.length > 0 && (
                            <div className={styles.tagRow}>
                                {doc.tags.map((tag) => (
                                    <span key={tag.id} className={styles.tagBadge}>
                                        {tag.name}
                                    </span>
                                ))}
                            </div>
                        )}

                        {doc.sender && (
                            <p className={styles.senderMeta}>
                                {highlight(doc.sender.includes("<")
                                    ? doc.sender.slice(0, doc.sender.indexOf("<")).trim() || doc.sender
                                    : doc.sender)}
                            </p>
                        )}

                        {doc.raw_html && (
                            <span className={styles.emailBadge}>이메일</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
