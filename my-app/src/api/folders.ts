import { api } from "./client";

// GET /folders — 현재 사용자의 폴더 목록 조회
// folderType : "document" | "email" — 생략하면 전체 반환
export const getFolders = async (folderType?: "document" | "email") => {
    const res = await api.get("/folders", {
        params: folderType ? { folder_type: folderType } : undefined,
    });
    return res.data;
};

// POST /folders — 새 폴더 생성
// folderType : "document"(기본) 또는 "email"
export const createFolder = async (
    name: string,
    folderType: "document" | "email" = "document",
) => {
    const res = await api.post("/folders", { name, folder_type: folderType });
    return res.data;
};

// PATCH /folders/:id — 폴더 이름 수정
export const updateFolder = async (id: string, name: string) => {
    const res = await api.patch(`/folders/${id}`, { name });
    return res.data;
};

// DELETE /folders/:id — 폴더 삭제
export const deleteFolder = async (id: string) => {
    const res = await api.delete(`/folders/${id}`);
    return res.data;
};
