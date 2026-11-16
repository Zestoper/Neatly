import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { loginUser, getMe, socialLoginUrl } from "../api/auth";
import { useToast } from "../context/ToastContext";
import styles from "./Auth.module.css";

export default function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const location = useLocation();
    const shown = useRef(false);

    // 소셜 로그인이 실패하면 백엔드가 /login?oauth_error=... 로, 콜백 페이지가 state.error 로 알려준다
    useEffect(() => {
        if (shown.current) return;
        const message =
            new URLSearchParams(location.search).get("oauth_error") ||
            (location.state as { error?: string } | null)?.error;
        if (!message) return;
        shown.current = true;
        showToast(message, "error");
        // 새로고침해도 같은 안내가 다시 뜨지 않게 주소에서 지운다
        navigate("/login", { replace: true, state: null });
    }, [location, navigate, showToast]);

    const handleLogin = async () => {
        if (!email.trim() || !password) return;
        setLoading(true);
        try {
            await attemptLogin();
        } finally {
            setLoading(false);
        }
    };

    const attemptLogin = async (retryCount = 0) => {
        try {
            const data = await loginUser(email, password);
            localStorage.setItem("token", data.access_token);

            try {
                const me = await getMe();
                localStorage.setItem("plan", me.plan);
                localStorage.setItem("userName", me.name || me.email);
            } catch {

            }

            navigate("/dashboard");
        } catch (err: unknown) {
            const isNetworkError = !((err as { response?: unknown })?.response);

            if (isNetworkError && retryCount < 2) {
                await attemptLogin(retryCount + 1);
            } else {
                showToast("이메일 또는 비밀번호를 다시 확인해주세요.");
            }
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <p className={styles.title}>Neatly</p>

                <input
                    className={styles.input}
                    placeholder="이메일"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
                <input
                    className={styles.input}
                    type="password"
                    placeholder="비밀번호"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                />

                <button
                    className={styles.button}
                    onClick={handleLogin}
                    disabled={loading}
                >
                    {loading ? "로그인 중..." : "로그인"}
                </button>

                <div className={styles.socialDivider}><span>또는</span></div>
                <div className={styles.socialRow}>
                    <a href={socialLoginUrl("kakao")} className={`${styles.socialBtn} ${styles.kakaoBtn}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.48 3 2 6.58 2 11c0 2.85 1.86 5.35 4.66 6.77l-.95 3.48c-.08.3.26.54.52.37l4.16-2.75c.53.07 1.06.11 1.61.11 5.52 0 10-3.58 10-8S17.52 3 12 3z" /></svg>
                        카카오로 시작하기
                    </a>
                    <a href={socialLoginUrl("google")} className={`${styles.socialBtn} ${styles.googleBtn}`}>
                        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
                        Google로 시작하기
                    </a>
                </div>

                <p className={styles.footer}>
                    계정이 없으신가요? <Link to="/register">회원가입</Link>
                </p>
            </div>
        </div>
    );
}
