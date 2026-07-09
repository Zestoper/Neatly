import { api } from "./client";

export const getDocuments = async () => {
    const res = await api.get("/documents");
    return res.data;
}

export const getDocument = async (id: string) => {

    const res = await api.get(`/documents/${id}`);

    return res.data;
}

export const updateDocument = async (
    id: string,
    title: string,
    summary: string,
    folder_id?: string | null
) => {
    const res = await api.put(`/documents/${id}`, {
        title,
        summary,
        folder_id: folder_id ?? null,
    });
    return res.data;
}

export const moveDocumentToFolder = async (id: string, folderId: string | null) => {
    const res = await api.patch(`/documents/${id}/folder`, null, {
        params: { folder_id: folderId ?? undefined },

    });
    return res.data;
}

export const deleteDocument = async (id: string) => {
    const res = await api.delete(`/documents/${id}`);
    return res.data;
}

export const uploadDocument = async (file: File, folderId?: string | null) => {

    const form = new FormData();
    form.append("file", file);
    if (folderId) form.append("folder_id", folderId);

    const res = await api.post("/documents/upload", form, {

        headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
}

export const getTrashDocuments = async () => {
    const res = await api.get("/documents/trash");
    return res.data;
};

export const restoreDocument = async (id: string) => {
    const res = await api.patch(`/documents/${id}/restore`);
    return res.data;
};

export const permanentlyDeleteDocument = async (id: string) => {
    const res = await api.delete(`/documents/${id}/permanent`);
    return res.data;
};

export const restoreGmailEmail = async (id: string) => {
    const res = await api.post(`/documents/${id}/restore-gmail`);
    return res.data;
};

export const createDocument = async (
    title: string,
    summary: string,
    folder_id?: string | null
) => {
    const res = await api.post("/documents", {
        title,
        summary,
        folder_id: folder_id ?? null,
    });

    return res.data;
}
