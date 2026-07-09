import { api } from "./client";

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
