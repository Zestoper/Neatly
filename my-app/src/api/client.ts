import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

let redirecting = false;

export const api = axios.create({
    baseURL: BASE_URL,
    timeout: 90000,
});

export async function warmUpServer() {
    try {
        await axios.get(`${BASE_URL}/health`, { timeout: 90000 });
    } catch {

    }
}

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;

    }

    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && !redirecting) {
            redirecting = true;
            localStorage.removeItem("token");
            window.location.href = "/login";
        }
        return Promise.reject(error);
    }
);
