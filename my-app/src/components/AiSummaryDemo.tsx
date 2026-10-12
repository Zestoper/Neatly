import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, FileText, Mail, Sparkles } from "lucide-react";
import styles from "./AiSummaryDemo.module.css";

// 랜딩 미리보기용 데모 — 실제 API 없이 "문서 업로드 → AI가 읽기 → 요약 작성 → 키워드 추출" 흐름을 재현한다.
type DemoDoc = {
    icon: LucideIcon;
    title: string;
    tag: string;
    summary: string;
    keywords: string[];
    seconds: string;
};

const DOCS: DemoDoc[] = [
    {
        icon: FileText,
        title: "3분기_마케팅_보고서.pdf",
        tag: "보고서",
        summary: "3분기 매출은 전 분기보다 18% 늘었고 신규 고객의 절반이 인스타그램 광고로 들어왔어요. 4분기에는 숏폼 광고 예산을 30% 늘리자고 제안해요.",
        keywords: ["매출 18% 증가", "인스타그램 유입", "4분기 예산"],
        seconds: "1.4초",
    },
    {
        icon: Mail,
        title: "[회의] 다음 주 일정 공유",
        tag: "Gmail",
        summary: "다음 주 화요일 오후 2시에 기획 회의가 잡혔어요. 금요일까지 각자 진행 상황을 공유 문서에 정리해 달라는 요청이에요.",
        keywords: ["화 오후 2시", "금요일까지 정리"],
        seconds: "0.9초",
    },
    {
        icon: FileText,
        title: "신규_서비스_기획안.docx",
        tag: "기획",
        summary: "1인 가구를 위한 구독형 정리 서비스 기획안이에요. 첫 달 무료 체험으로 가입자를 모으고 3개월 안에 유료 전환율 12%를 목표로 해요.",
        keywords: ["구독형 서비스", "전환율 12% 목표"],
        seconds: "1.6초",
    },
    {
        icon: Mail,
        title: "[견적] 서버 비용 견적서 회신",
        tag: "Gmail",
        summary: "클라우드 서버 견적이 월 42만 원으로 왔어요. 1년 약정이면 15% 할인되고 이번 달 말까지 답변을 달라고 해요.",
        keywords: ["월 42만 원", "약정 15% 할인", "월말 회신"],
        seconds: "1.1초",
    },
];

type Phase = "upload" | "reading" | "typing" | "done";

const UPLOAD_MS = 900;   // 업로드 진행 바
const READING_MS = 1500; // AI가 읽는 중 (스캔 효과)
const TYPE_MS = 26;      // 한 글자 타이핑 간격
const HOLD_MS = 3200;    // 완료 후 다음 문서까지 대기

function usePrefersReducedMotion() {
    const [reduce] = useState(
        () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    );
    return reduce;
}

function useInView<T extends Element>() {
    const ref = useRef<T>(null);
    const [inView, setInView] = useState(true);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
        io.observe(el);
        return () => io.disconnect();
    }, []);
    return [ref, inView] as const;
}

function DemoCard({ doc, phase, typed }: { doc: DemoDoc; phase: Phase; typed: number }) {
    const Icon = doc.icon;
    const showSummary = phase !== "upload";
    const text = phase === "done" ? doc.summary : doc.summary.slice(0, typed);

    return (
        <div className={`${styles.card} ${phase === "reading" ? styles.scanning : ""}`}>
            <div className={styles.head}>
                <span className={styles.icon}><Icon size={16} /></span>
                <span className={styles.title}>{doc.title}</span>
                <span className={styles.tag}>{doc.tag}</span>
            </div>

            {phase === "upload" && (
                <div className={styles.upload}>
                    <span className={styles.uploadLabel}>업로드 중</span>
                    <span className={styles.uploadTrack}><span className={styles.uploadFill} /></span>
                </div>
            )}

            {showSummary && (
                <div className={styles.summary}>
                    <div className={styles.label}>
                        {phase === "done" ? (
                            <>
                                <span className={styles.doneDot}><Check size={11} strokeWidth={3} /></span>
                                AI 요약
                                <span className={styles.meta}>{doc.seconds} 만에 정리</span>
                            </>
                        ) : (
                            <>
                                <Sparkles size={13} className={styles.sparkle} />
                                {phase === "reading" ? "AI가 문서를 읽는 중" : "AI가 요약하는 중"}
                                <span className={styles.dots}><i /><i /><i /></span>
                            </>
                        )}
                    </div>

                    {phase === "reading" ? (
                        <div className={styles.skeleton}>
                            <span style={{ width: "94%" }} />
                            <span style={{ width: "81%" }} />
                            <span style={{ width: "62%" }} />
                        </div>
                    ) : (
                        <p className={styles.text}>
                            {text}
                            {phase === "typing" && <span className={styles.caret} />}
                        </p>
                    )}

                    {phase === "done" && (
                        <div className={styles.keywords}>
                            {doc.keywords.map((k, i) => (
                                <span key={k} className={styles.keyword} style={{ animationDelay: `${i * 90}ms` }}>
                                    #{k}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function AiSummaryDemo() {
    const reduce = usePrefersReducedMotion();
    const [ref, inView] = useInView<HTMLDivElement>();
    // 최신 문서가 맨 위. cycle은 같은 문서가 다시 들어올 때 새 카드로 취급하기 위한 번호
    const [stack, setStack] = useState<{ doc: number; cycle: number }[]>([
        { doc: 0, cycle: 1 },
        { doc: DOCS.length - 1, cycle: 0 },
    ]);
    const [phase, setPhase] = useState<Phase>(reduce ? "done" : "upload");
    const [typed, setTyped] = useState(0);

    const top = DOCS[stack[0].doc];

    useEffect(() => {
        if (reduce || !inView) return; // 움직임 줄이기 설정이거나 화면 밖이면 멈춤
        let t: number;
        if (phase === "upload") t = window.setTimeout(() => setPhase("reading"), UPLOAD_MS);
        else if (phase === "reading") t = window.setTimeout(() => setPhase("typing"), READING_MS);
        else if (phase === "typing") {
            if (typed < top.summary.length) t = window.setTimeout(() => setTyped((n) => n + 1), TYPE_MS);
            else t = window.setTimeout(() => setPhase("done"), 250);
        } else {
            t = window.setTimeout(() => {
                setStack((s) => [{ doc: (s[0].doc + 1) % DOCS.length, cycle: s[0].cycle + 1 }, ...s].slice(0, 3));
                setTyped(0);
                setPhase("upload");
            }, HOLD_MS);
        }
        return () => window.clearTimeout(t);
    }, [phase, typed, inView, reduce, top.summary.length]);

    return (
        <div ref={ref} className={styles.list}>
            {stack.map((item, i) => (
                <div key={`${item.doc}-${item.cycle}`} className={i === 0 && !reduce ? styles.enter : undefined}>
                    <DemoCard doc={DOCS[item.doc]} phase={i === 0 ? phase : "done"} typed={typed} />
                </div>
            ))}
        </div>
    );
}
