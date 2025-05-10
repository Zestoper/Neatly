import { api } from "./client"; // api : 공통 axios 인스턴스

// GET /documents — 현재 로그인 사용자의 문서 목록 조회
export const getDocuments = async () => {
    const res = await api.get("/documents");
    return res.data; // res.data : Document 객체 배열
}

// GET /documents/:id — 문서 하나를 id로 조회
export const getDocument = async (id: string) => {
    // id : URL에 넣을 문서 ID — 백엔드의 {document_id}와 매칭
    const res = await api.get(`/documents/${id}`);
    // 템플릿 리터럴(``) : 문자열 안에 변수를 ${} 형태로 삽입
    return res.data; // res.data : 조회된 Document 객체 하나
}

// PUT /documents/:id — 문서 제목·본문·폴더 수정
export const updateDocument = async (
    id: string,
    title: string,
    summary: string,
    folder_id?: string | null // folder_id : 변경할 폴더 ID, null이면 폴더 없음
) => {
    const res = await api.put(`/documents/${id}`, {
        title,
        summary,
        folder_id: folder_id ?? null,
    });
    return res.data;
}

// PATCH /documents/:id/folder — 폴더만 변경 (드래그 앤 드롭용)
// PUT과 달리 제목·본문을 보내지 않아도 됨 — folder_id만 쿼리 파라미터로 전달
// folderId가 null이면 파라미터를 생략 → 백엔드에서 None으로 받아 폴더 없음으로 처리
export const moveDocumentToFolder = async (id: string, folderId: string | null) => {
    const res = await api.patch(`/documents/${id}/folder`, null, {
        params: { folder_id: folderId ?? undefined },
        // null : 요청 body 없음 (PATCH지만 body가 필요 없는 구조)
        // params : URL 쿼리스트링으로 전달 → /documents/{id}/folder?folder_id=abc
    });
    return res.data;
}

// DELETE /documents/:id — 문서 삭제
export const deleteDocument = async (id: string) => {
    const res = await api.delete(`/documents/${id}`); // id : 삭제할 문서 ID
    return res.data; // res.data : { message: "삭제되었습니다." }
}

// POST /documents/upload — 파일을 업로드하면 텍스트 추출 + AI 요약 후 문서 생성
// file : 사용자가 선택한 파일 객체 (PDF, DOCX, TXT, MD)
// folderId : 저장할 폴더 ID, 없으면 null
export const uploadDocument = async (file: File, folderId?: string | null) => {
    // FormData : 파일과 텍스트 필드를 함께 multipart/form-data 형식으로 전송
    const form = new FormData();
    form.append("file", file);
    if (folderId) form.append("folder_id", folderId);

    const res = await api.post("/documents/upload", form, {
        // Content-Type 헤더를 명시하지 않으면 axios가 FormData임을 감지해 자동 설정
        headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data; // res.data : 생성된 Document 객체
}

// GET /documents/trash — 휴지통 문서 목록
export const getTrashDocuments = async () => {
    const res = await api.get("/documents/trash");
    return res.data;
};

// PATCH /documents/{id}/restore — 문서 복원
export const restoreDocument = async (id: string) => {
    const res = await api.patch(`/documents/${id}/restore`);
    return res.data;
};

// DELETE /documents/{id}/permanent — 영구 삭제
export const permanentlyDeleteDocument = async (id: string) => {
    const res = await api.delete(`/documents/${id}/permanent`);
    return res.data;
};

// POST /documents/{id}/restore-gmail — Gmail 휴지통에서 받은편지함으로 복원
export const restoreGmailEmail = async (id: string) => {
    const res = await api.post(`/documents/${id}/restore-gmail`);
    return res.data;
};

// POST /documents — 새 문서 생성
export const createDocument = async (
    title: string,
    summary: string,
    folder_id?: string | null // folder_id : 속할 폴더 ID, 없으면 생략
) => {
    const res = await api.post("/documents", {
        title,
        summary,
        folder_id: folder_id ?? null,
    });

    return res.data;
}
