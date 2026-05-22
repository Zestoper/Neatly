import { useEffect, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import Sidebar from "./Sidebar";
import ChatModal from "./ChatModal";
import { getMe } from "../api/auth";
import { useCalendarNotifications } from "../hooks/useCalendarNotifications";
import styles from "./Layout.module.css";

export default function Layout({ children }: { children: React.ReactNode }) {
    useCalendarNotifications();
    const isMobile = () => window.innerWidth <= 767;
    const [sidebarOpen, setSidebarOpen] = useState(() => !isMobile());
    const location = useLocation();

    useEffect(() => {
        getMe().then((data) => {
            localStorage.setItem("plan", data.plan);
            localStorage.setItem("userName", data.name ?? "");
        }).catch(() => {});
    }, []);

    // 모바일에서 페이지 이동 시 사이드바 자동 닫기
    useEffect(() => {
        if (isMobile()) setSidebarOpen(false);
    }, [location.pathname]);

    // 창 크기 변경 시 데스크탑이면 사이드바 자동 열기
    useEffect(() => {
        const handler = () => { if (!isMobile()) setSidebarOpen(true); };
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
    }, []);

    return (
        <div className={styles.container}>
            <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen((prev) => !prev)} />

            {/* 모바일 — 사이드바 열렸을 때 뒤 영역 어둡게 + 클릭 시 닫기 */}
            {sidebarOpen && (
                <div className={styles.backdrop} onClick={() => setSidebarOpen(false)} />
            )}

            <main className={styles.main}>
                {/* 모바일 전용 상단 바 */}
                {!sidebarOpen && (
                    <div className={styles.mobileHeader}>
                        <button
                            className={styles.mobileMenuButton}
                            onClick={() => setSidebarOpen(true)}
                            aria-label="메뉴 열기"
                        >
                            &#9776;
                        </button>
                        <Link to="/" className={styles.mobileLogo}>Neatly</Link>
                    </div>
                )}
                <div className={styles.content}>
                    {children}
                </div>
            </main>

            <ChatModal />
        </div>
    );
}
