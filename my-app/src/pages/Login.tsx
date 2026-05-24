import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginUser, getMe } from "../api/auth";
import { warmUpServer } from "../api/client";
import { useToast } from "../context/ToastContext";
import styles from "./Auth.module.css";

export default function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [warming, setWarming] = useState(false);
    const { showToast } = useToast();

    // 페이지 진입 즉시 서버 미리 깨우기 — 콜드 스타트 대기를 로그인 전에 소모
    useEffect(() => {
        setWarming(true);
        warmUpServer().finally(() => setWarming(false));
    }, []);

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

            // 사용자 정보 로드 — 실패해도 대시보드로 이동 (Layout이 재시도)
            try {
                const me = await getMe();
                localStorage.setItem("plan", me.plan);
                localStorage.setItem("userName", me.name || me.email);
            } catch {
                // getMe 실패 시 기본값 유지, Layout 마운트 시 재조회
            }

            navigate("/");
        } catch (err: unknown) {
            const isNetworkError = !((err as { response?: unknown })?.response);
            // 로그인 자체가 네트워크 오류면 최대 2회 재시도
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

                {warming && (
                    <p className={styles.warmingNote}>서버를 시작하는 중입니다...</p>
                )}

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

                <p className={styles.footer}>
                    계정이 없으신가요? <Link to="/register">회원가입</Link>
                </p>
            </div>
        </div>
    );
}
