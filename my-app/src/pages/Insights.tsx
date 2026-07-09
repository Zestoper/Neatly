import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDocuments } from "../api/documents";
import styles from "./Insights.module.css";

type Document = {
    id: string;
    title: string;
    created_at: string;
};

export default function Insights() {
    const navigate = useNavigate();
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getDocuments()
            .then((data) => setDocuments(data))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <p>불러오는 중...</p>;

    const now = new Date();

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisWeek  = documents.filter((d) => new Date(d.created_at) >= startOfWeek).length;
    const thisMonth = documents.filter((d) => new Date(d.created_at) >= startOfMonth).length;

    const recent = documents
        .slice()
        .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
        .slice(0, 5);

    const monthlyMap: Record<string, number> = {};
    documents.forEach((d) => {
        const date = new Date(d.created_at);
        const month = String(date.getMonth() + 1).padStart(2, "0");

        const key = `${date.getFullYear()}-${month}`;
        monthlyMap[key] = (monthlyMap[key] ?? 0) + 1;
    });

    const monthlyEntries = Object.entries(monthlyMap)
        .sort(([a], [b]) => (a > b ? 1 : -1));

    const maxCount = Math.max(...monthlyEntries.map(([, count]) => count), 1);

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });

    return (
        <div className={styles.container}>
            <h1 className={styles.pageTitle}>Insights</h1>

            <div className={styles.statsRow}>
                <div className={styles.statCard}>
                    <p className={styles.statLabel}>전체 문서</p>
                    <p className={styles.statValue}>{documents.length}</p>
                </div>
                <div className={styles.statCard}>
                    <p className={styles.statLabel}>이번 달</p>
                    <p className={styles.statValue}>{thisMonth}</p>
                </div>
                <div className={styles.statCard}>
                    <p className={styles.statLabel}>이번 주</p>
                    <p className={styles.statValue}>{thisWeek}</p>
                </div>
            </div>

            {monthlyEntries.length > 0 && (
                <section className={styles.section}>
                    <p className={styles.sectionLabel}>월별 작성 현황</p>
                    <div className={styles.chart}>
                        {monthlyEntries.map(([month, count]) => (
                            <div key={month} className={styles.barGroup}>
                                <p className={styles.barCount}>{count}</p>
                                <div
                                    className={styles.bar}
                                    style={{ height: `${(count / maxCount) * 80}px` }}

                                />
                                <p className={styles.barLabel}>{month.slice(5)}월</p>

                            </div>
                        ))}
                    </div>
                </section>
            )}

            {recent.length > 0 && (
                <section className={styles.section}>
                    <p className={styles.sectionLabel}>최근 작성</p>
                    <div className={styles.recentList}>
                        {recent.map((doc) => (
                            <div
                                key={doc.id}
                                className={styles.recentItem}
                                onClick={() => navigate(`/documents/${doc.id}`)}
                            >
                                <p className={styles.recentTitle}>{doc.title}</p>
                                <p className={styles.recentDate}>{formatDate(doc.created_at)}</p>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {documents.length === 0 && <p>아직 작성한 문서가 없습니다.</p>}
        </div>
    );
}
