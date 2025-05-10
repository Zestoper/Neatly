import { api } from "./client"; // api : 공통 axios 인스턴스

// POST /auth/login — 로그인 성공 시 access_token 반환
export const loginUser = async (
    email: string,   // email : 로그인용 이메일
    password: string // password : 평문 비밀번호
) => {
    const res = await api.post("/auth/login", {
        email,
        password,
    });

    return res.data; // res.data : { access_token, token_type }
}

// GET /auth/me — localStorage의 토큰으로 현재 사용자 정보 조회
export const getMe = async () => {
    // 토큰은 client.ts 인터셉터가 모든 요청에 자동으로 헤더에 추가
    const res = await api.get("/auth/me");
    return res.data; // res.data : { id, email, plan }
}
