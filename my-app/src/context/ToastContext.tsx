import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

// 토스트 종류 — 성공(초록)이냐 에러(빨강)이냐
type ToastType = "success" | "error";

// 토스트 하나의 구조 — id로 구분, message는 표시할 텍스트, type은 색상 결정
type ToastItem = {
    id: number;       // Date.now()로 생성한 고유 숫자 — 나중에 이 id로 해당 토스트만 삭제
    message: string;  // 화면에 보여줄 텍스트 ex) "동기화 완료"
    type: ToastType;  // "success" | "error"
};

// 캘린더 알림에서 버튼 하나의 구조 ex) "일정 보기" 버튼
type AlertLink = {
    label: string;  // 버튼에 표시할 텍스트
    path: string;   // 버튼 클릭 시 이동할 경로
};

// 캘린더 알림 하나의 구조 — 토스트보다 더 많은 정보를 담음
type AlertItem = {
    id: number;          // 고유 id
    title: string;       // 알림 제목 ex) "일정 알림"
    body: string;        // 알림 내용 ex) "팀 회의 10분 후"
    links?: AlertLink[]; // 버튼 목록 (없을 수도 있어서 ? 붙임)
};

// Context에서 외부에 제공하는 함수 목록
type ToastContextValue = {
    showToast: (message: string, type?: ToastType) => void;           // 토스트 띄우기
    showCalendarAlert: (title: string, body: string, links?: AlertLink[]) => void; // 캘린더 알림 띄우기
};

// Context 생성 — Provider 밖에서 useToast()를 쓰면 아무것도 안 하는 빈 함수가 실행됨
const ToastContext = createContext<ToastContextValue>({
    showToast: () => {},
    showCalendarAlert: () => {},
});

// 커스텀 훅 — 어느 컴포넌트에서든 useToast()로 showToast를 꺼내 쓸 수 있음
export function useToast() {
    return useContext(ToastContext);
}

// Provider — App.tsx에서 전체 앱을 이걸로 감싸면 모든 자식 컴포넌트가 Context에 접근 가능
export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);  // 현재 화면에 떠있는 토스트 목록
    const [alerts, setAlerts] = useState<AlertItem[]>([]);  // 현재 화면에 떠있는 캘린더 알림 목록

    // showToast — 토스트를 추가하고 3초 후 자동 삭제
    // useCallback: 리렌더링마다 함수가 새로 만들어지지 않게 고정 — Context value가 불필요하게 바뀌는 것 방지
    const showToast = useCallback((message: string, type: ToastType = "success") => {
        const id = Date.now(); // 현재 시간(ms)을 id로 사용 — 같은 메시지가 여러 번 떠도 각각 독립적으로 관리
        setToasts((prev) => [...prev, { id, message, type }]); // 기존 목록에 새 토스트 추가
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id)); // 3초 후 이 id의 토스트만 제거
        }, 3000);
    }, []);

    // showCalendarAlert — 캘린더 알림을 추가하고 8초 후 자동 삭제
    const showCalendarAlert = useCallback((title: string, body: string, links?: AlertLink[]) => {
        const id = Date.now();
        setAlerts((prev) => [...prev, { id, title, body, links }]);
        setTimeout(() => {
            setAlerts((prev) => prev.filter((a) => a.id !== id)); // 8초 후 제거
        }, 8000);
    }, []);

    // dismissAlert — X 버튼 클릭 시 해당 알림 즉시 제거
    const dismissAlert = (id: number) => {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
    };

    return (
        // value로 넘긴 함수들을 자식 컴포넌트에서 useToast()로 꺼내 쓸 수 있음
        <ToastContext.Provider value={{ showToast, showCalendarAlert }}>
            {children}

            {/* 일반 토스트 — 상단 우측 */}
            <div style={{
                position: "fixed",
                top: 24,
                right: 16,
                maxWidth: "calc(100vw - 32px)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                zIndex: 9999,
                pointerEvents: "none", // 토스트 위에 마우스가 올라가도 뒤에 있는 요소 클릭 가능
            }}>
                {/* toasts 배열을 순회하며 토스트 하나씩 렌더링 */}
                {toasts.map((t) => (
                    <div
                        key={t.id} // React가 각 토스트를 구분하는 데 사용
                        style={{
                            padding: "11px 18px",
                            background: t.type === "error" ? "#e03e3e" : "var(--color-text)", // 에러면 빨강, 성공이면 기본색
                            color: "#fff",
                            borderRadius: 8,
                            fontSize: 13.5,
                            boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            animation: "toast-in 0.18s ease", // 아래 @keyframes toast-in 애니메이션 적용
                        }}
                    >
                        {t.message}
                    </div>
                ))}
            </div>

            {/* 캘린더 알림 — 상단 중앙 */}
            <div style={{
                position: "fixed",
                top: 24,
                left: "50%",
                transform: "translateX(-50%)", // 정확히 가운데 정렬
                display: "flex",
                flexDirection: "column",
                gap: 10,
                zIndex: 10000, // 토스트(9999)보다 위에 표시
                pointerEvents: "auto",
            }}>
                {alerts.map((a) => (
                    <div
                        key={a.id}
                        style={{
                            padding: "14px 18px",
                            background: "#fff",
                            border: "1.5px solid var(--color-accent, #4f46e5)",
                            borderRadius: 12,
                            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                            animation: "toast-in 0.2s ease",
                            minWidth: 260,
                            maxWidth: "80vw",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div>
                                {/* 알림 제목 */}
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-accent, #4f46e5)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                                    {a.title}
                                </div>
                                {/* 알림 내용 */}
                                <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>
                                    {a.body}
                                </div>
                            </div>
                            {/* X 버튼 — 클릭 시 즉시 알림 제거 */}
                            <button
                                onClick={() => dismissAlert(a.id)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* 링크 버튼 목록 — links가 있을 때만 렌더링 */}
                        {a.links && a.links.length > 0 && (
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                {a.links.map((link) => (
                                    <button
                                        key={link.path}
                                        onClick={() => { dismissAlert(a.id); window.location.href = link.path; }} // 알림 닫고 해당 경로로 이동
                                        style={{
                                            padding: "5px 12px",
                                            fontSize: 12,
                                            fontWeight: 600,
                                            border: "1px solid var(--color-accent, #4f46e5)",
                                            borderRadius: 6,
                                            background: "none",
                                            color: "var(--color-accent, #4f46e5)",
                                            cursor: "pointer",
                                        }}
                                    >
                                        {link.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* 토스트/알림 등장 애니메이션 — 위에서 살짝 내려오면서 나타남 */}
            <style>{`
                @keyframes toast-in {
                    from { opacity: 0; transform: translateY(-10px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </ToastContext.Provider>
    );
}
