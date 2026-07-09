import { api } from "./client";

export const getFolders = async (folderType?: "document" | "email") => {
    const res = await api.get("/folders", {
        params: folderType ? { folder_type: folderType } : undefined,
    });
    return res.data;
};

export const createFolder = async (
    name: string,
    folderType: "document" | "email" = "document",
) => {
    const res = await api.post("/folders", { name, folder_type: folderType });
    return res.data;
};

export const updateFolder = async (id: string, name: string) => {
    const res = await api.patch(`/folders/${id}`, { name });
    return res.data;
};

export const deleteFolder = async (id: string) => {
    const res = await api.delete(`/folders/${id}`);
    return res.data;
};
