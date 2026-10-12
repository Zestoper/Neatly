import { Link } from "react-router-dom";
import AiSummaryDemo from "../components/AiSummaryDemo";
import styles from "./Landing.module.css";
import { FileText, ListChecks, Mail, MessagesSquare } from "lucide-react";

// 로그인 없이 보이는 첫 화면. API를 호출하지 않아서 서버가 자고 있어도 바로 뜬다.
const FEATURES = [
    {
        icon: FileText,
        title: "업로드하면 바로 요약",
        desc: "PDF · DOCX · TXT를 올리면 텍스트를 추출하고 AI가 3~4문장으로 요약해요.",
    },
    {
        icon: Mail,
        title: "Gmail을 문서처럼",
        desc: "Google 계정을 연결하면 메일을 문서로 가져와 요약까지 자동으로 붙여줘요.",
    },
    {
        icon: ListChecks,
        title: "AI 브리핑과 Q&A",
        desc: "오늘 들어온 문서를 한 번에 브리핑하고 문서 내용으로 질문에 답해요.",
    },
    {
        icon: MessagesSquare,
        title: "실시간 채팅",
        desc: "WebSocket 기반 그룹 채팅과 1:1 DM으로 문서를 보면서 바로 이야기해요.",
    },
];

const STEPS = [
    { no: "01", title: "올리기", desc: "파일을 끌어다 놓거나 Gmail을 연결해요." },
    { no: "02", title: "정리되기", desc: "AI 요약이 붙고 폴더 · 태그로 분류돼요." },
    { no: "03", title: "찾아쓰기", desc: "검색 · 브리핑 · Q&A로 필요한 내용만 꺼내요." },
];

export default function Landing() {
    const loggedIn = !!localStorage.getItem("token");

    return (
        <div className={styles.page}>
            <header className={styles.nav}>
                <div className={styles.navInner}>
                    <Link to="/" className={styles.logo}>Neatly</Link>
                    <nav className={styles.navActions}>
                        {loggedIn ? (
                            <Link to="/dashboard" className={styles.primarySm}>대시보드로 이동</Link>
                        ) : (
                            <>
                                <Link to="/login" className={styles.ghostSm}>로그인</Link>
                                <Link to="/register" className={styles.primarySm}>무료로 시작하기</Link>
                            </>
                        )}
                    </nav>
                </div>
            </header>

            <main>
                <section className={styles.hero}>
                    <span className={styles.badge}>AI 문서 관리</span>
                    <h1 className={styles.headline}>
                        흩어진 문서와 메일을
                        <br />
                        <span className={styles.accent}>한 곳에서 깔끔하게</span>
                    </h1>
                    <p className={styles.sub}>
                        올리기만 하면 AI가 요약하고 정리해요.{" "}
                        <br className={styles.brDesktop} />
                        Gmail까지 연결해서 읽어야 할 것만 빠르게 확인하세요.
                    </p>
                    <div className={styles.ctaRow}>
                        {loggedIn ? (
                            <Link to="/dashboard" className={styles.primary}>대시보드로 이동</Link>
                        ) : (
                            <>
                                <Link to="/register" className={styles.primary}>무료로 시작하기</Link>
                                <Link to="/login" className={styles.ghost}>로그인</Link>
                            </>
                        )}
                    </div>

                    {/* 실제 화면 대신 CSS로 그린 미리보기 */}
                    <div className={styles.preview} aria-hidden="true">
                        <div className={styles.previewBar}>
                            <span /><span /><span />
                        </div>
                        <div className={styles.previewBody}>
                            <aside className={styles.previewSide}>
                                <b>Neatly</b>
                                <i className={styles.sideActive}>Dashboard</i>
                                <i>Documents</i>
                                <i>Emails</i>
                                <i>Insights</i>
                            </aside>
                            <div className={styles.previewMain}>
                                <AiSummaryDemo />
                            </div>
                        </div>
                    </div>
                </section>

                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>문서 관리에 필요한 것만</h2>
                    <div className={styles.grid}>
                        {FEATURES.map((f) => (
                            <article key={f.title} className={styles.feature}>
                                <span className={styles.featureIcon}><f.icon size={20} strokeWidth={1.75} /></span>
                                <h3>{f.title}</h3>
                                <p>{f.desc}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>세 단계면 끝</h2>
                    <ol className={styles.steps}>
                        {STEPS.map((s) => (
                            <li key={s.no} className={styles.step}>
                                <span className={styles.stepNo}>{s.no}</span>
                                <h3>{s.title}</h3>
                                <p>{s.desc}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                <section className={styles.final}>
                    <h2>지금 바로 정리를 시작해보세요</h2>
                    <p>FREE 플랜으로 가입하고 바로 써보세요.</p>
                    <Link to={loggedIn ? "/dashboard" : "/register"} className={styles.primary}>
                        {loggedIn ? "대시보드로 이동" : "무료로 시작하기"}
                    </Link>
                </section>
            </main>

            <footer className={styles.footer}>© Neatly</footer>
        </div>
    );
}
