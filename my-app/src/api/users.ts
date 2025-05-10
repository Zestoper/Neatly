import { api } from "./client";

// POST /register — 신규 회원가입
export const registerUser = async (
    email: string,
    password: string,
    name: string,
    phone: string,
    birthDate: string, // birthDate : YYYY-MM-DD 형식
) => {
    const res = await api.post("/register", {
        email,
        password,
        name,
        phone,
        birth_date: birthDate, // birth_date : 백엔드 필드명에 맞춤
    });

    return res.data;
}

// PATCH /users/me — 로그인한 사용자의 프로필 수정
export const updateMe = async (data: {
    name?: string;
    phone?: string;
    birth_date?: string;
}) => {
    const res = await api.patch("/users/me", data);
    return res.data;
}

// PATCH /auth/password — 비밀번호 변경
export const changePassword = async (currentPassword: string, newPassword: string) => {
    const res = await api.patch("/auth/password", {
        current_password: currentPassword,
        new_password: newPassword,
    });
    return res.data;
};

// updatePlan : 플랜만 변경하는 함수 — PATCH /users/me에 plan만 담아서 전송
export const updatePlan = async (plan: "FREE" | "STANDARD" | "PREMIUM") => {
    // "FREE" | "STANDARD" | "PREMIUM" : TypeScript 리터럴 타입 — 이 세 가지 문자열만 허용
    const res = await api.patch("/users/me", { plan });
    // { plan } : { plan: plan } 축약 — 키와 변수명이 같을 때 줄여 쓸 수 있음
    return res.data; // data.plan : 백엔드가 반환한 실제 변경된 플랜 값
}
