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

    useEffect(() => {
        if (isMobile()) setSidebarOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        const handler = () => { if (!isMobile()) setSidebarOpen(true); };
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
    }, []);

    return (
        <div className={styles.container}>
            <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen((prev) => !prev)} />

            {sidebarOpen && (
                <div className={styles.backdrop} onClick={() => setSidebarOpen(false)} />
            )}

            <main className={styles.main}>

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
