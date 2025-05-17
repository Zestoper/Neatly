import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDocuments } from "../api/documents";
import styles from "./Insights.module.css";

type Document = {
    id: string;
    title: string;
    created_at: string; // created_at : ISO 형식 날짜 문자열 (예: "2026-05-11T12:00:00")
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

    const now = new Date(); // now : 현재 날짜·시각

    // 이번 주 월요일 00:00:00 계산
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // getDay() : 요일 (일=0, 월=1 ... 토=6)
    startOfWeek.setHours(0, 0, 0, 0);                      // 시·분·초·밀리초를 0으로 초기화

    // 이번 달 1일 00:00:00
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // getFullYear() : 연도 / getMonth() : 월 (0~11) / 1 : 1일

    // 이번 주·달에 작성된 문서 수
    const thisWeek  = documents.filter((d) => new Date(d.created_at) >= startOfWeek).length;
    const thisMonth = documents.filter((d) => new Date(d.created_at) >= startOfMonth).length;

    // 최신순 정렬 후 앞에서 5개만 추출
    const recent = documents
        .slice()
        .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
        .slice(0, 5); // slice(0, 5) : 인덱스 0부터 4까지, 즉 앞 5개

    // 월별 문서 수 집계
    const monthlyMap: Record<string, number> = {}; // Record<string, number> : key가 문자열, value가 숫자인 객체
    documents.forEach((d) => {
        const date = new Date(d.created_at);
        const month = String(date.getMonth() + 1).padStart(2, "0");
        // getMonth() : 0~11 반환이라 +1 / padStart(2, "0") : 한 자리 숫자 앞에 0 붙임 (5 → "05")
        const key = `${date.getFullYear()}-${month}`; // key 예시 : "2026-05"
        monthlyMap[key] = (monthlyMap[key] ?? 0) + 1; // 해당 달이 처음이면 0, 아니면 기존 값에 +1
    });

    // 오래된 달부터 정렬
    const monthlyEntries = Object.entries(monthlyMap)
        .sort(([a], [b]) => (a > b ? 1 : -1));
    // Object.entries : { "2026-05": 3 } → [["2026-05", 3]] 형태로 변환

    const maxCount = Math.max(...monthlyEntries.map(([, count]) => count), 1);
    // Math.max : 가장 큰 값 반환 / 최소 1 보장 → 문서가 없을 때 0으로 나누는 것 방지

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
    // toLocaleDateString("ko-KR") : "5월 11일" 형태로 변환

    return (
        <div className={styles.container}>
            <h1 className={styles.pageTitle}>Insights</h1>

            {/* 요약 카드 3개 */}
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

            {/* 월별 바 차트 — 문서가 하나라도 있을 때만 표시 */}
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
                                    // (count / maxCount) * 80 : 최대 80px 기준으로 비율 계산
                                />
                                <p className={styles.barLabel}>{month.slice(5)}월</p>
                                {/* slice(5) : "2026-05" → "05" */}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* 최근 문서 목록 */}
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
