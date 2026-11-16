import { api } from "./client";

// 구글/카카오 로그인 시작 주소 — 버튼을 누르면 이 주소로 이동하고, 백엔드가 로그인 화면으로 보내준다
export const socialLoginUrl = (provider: "kakao" | "google") =>
    `${api.defaults.baseURL}/auth/social/${provider}/login`;

export const loginUser = async (
    email: string,
    password: string
) => {
    const res = await api.post("/auth/login", {
        email,
        password,
    });

    return res.data;
}

export const getMe = async () => {

    const res = await api.get("/auth/me");
    return res.data;
}
