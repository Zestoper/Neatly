import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const api = axios.create({
    baseURL: BASE_URL,
    timeout: 90000, // 90초 — Render 콜드 스타트(최대 ~60초)를 커버
});

// 서버를 미리 깨우는 함수 — 로그인/회원가입 페이지 진입 시 호출
export async function warmUpServer() {
    try {
        await axios.get(`${BASE_URL}/health`, { timeout: 90000 });
    } catch {
        // 실패해도 무시 — 이미 깨어 있거나 네트워크 오류
    }
}

// 인터셉터 : 모든 요청이 나가기 전에 실행 — 토큰을 자동으로 헤더에 추가
api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token"); // token : 로그인 시 저장한 JWT

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        // config.headers.Authorization : 요청 헤더에 토큰을 담는 위치
        // Bearer : JWT 인증 방식의 접두사 — 백엔드가 이 형식으로 토큰을 읽음
    }

    return config; // 수정된 config를 반환해야 요청이 실제로 전송됨
});

// 응답 인터셉터 : 모든 API 응답이 들어올 때 실행
api.interceptors.response.use(
    (response) => response, // 정상 응답은 그대로 통과
    (error) => {
        if (error.response?.status === 401) {
            // 401 : 인증 실패 — 토큰 만료 또는 없음
            localStorage.removeItem("token"); // 만료된 토큰 제거
            window.location.href = "/login";  // 로그인 페이지로 강제 이동
        }
        return Promise.reject(error); // 다른 에러는 그대로 던져서 각 페이지에서 처리
    }
);
