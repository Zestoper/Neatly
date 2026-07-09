import { api } from "./client";

export const registerUser = async (
    email: string,
    password: string,
    name: string,
    phone: string,
    birthDate: string,
) => {
    const res = await api.post("/register", {
        email,
        password,
        name,
        phone,
        birth_date: birthDate,
    });

    return res.data;
}

export const updateMe = async (data: {
    name?: string;
    phone?: string;
    birth_date?: string;
}) => {
    const res = await api.patch("/users/me", data);
    return res.data;
}

export const changePassword = async (currentPassword: string, newPassword: string) => {
    const res = await api.patch("/auth/password", {
        current_password: currentPassword,
        new_password: newPassword,
    });
    return res.data;
};

export const updatePlan = async (plan: "FREE" | "STANDARD" | "PREMIUM") => {

    const res = await api.patch("/users/me", { plan });

    return res.data;
}
