import { api } from "./client";

// ChatRoom : 채팅방 정보 타입
export type ChatRoom = {
    id: string;
    name: string;
    document_id: string | null;
    created_by: string;
    member_count: number;
    unread_count: number;
    last_message: string | null;
    last_message_at: string;
    created_at: string;
};

// ChatMessage : 채팅 메시지 타입
export type ChatMessage = {
    id: string;
    user_id: string;
    user_name: string;
    content: string;
    created_at: string;
};

// getRooms : 내가 참여 중인 채팅방 목록 조회
export const getRooms = async (): Promise<ChatRoom[]> => {
    const res = await api.get("/chat/rooms");
    return res.data;
};

// createRoom : 새 채팅방 생성
export const createRoom = async (name: string, documentId?: string): Promise<ChatRoom> => {
    const res = await api.post("/chat/rooms", {
        name,
        document_id: documentId ?? null,
    });
    return res.data;
};

// joinRoom : 방 ID로 채팅방 참여
export const joinRoom = async (roomId: string): Promise<ChatRoom> => {
    const res = await api.post(`/chat/rooms/${roomId}/join`);
    return res.data;
};

// getMessages : 채팅방의 이전 메시지 기록 조회
export const getMessages = async (roomId: string): Promise<ChatMessage[]> => {
    const res = await api.get(`/chat/rooms/${roomId}/messages`);
    return res.data;
};

// Contact : 대화 상대 타입
export type Contact = {
    id: string;
    name: string;
    email: string;
    status?: "active" | "hidden" | "blocked";
};

// getContacts : 내 채팅방에 있는 다른 사용자 목록 (친구 탭용)
export const getContacts = async (): Promise<Contact[]> => {
    const res = await api.get("/chat/contacts");
    return res.data;
};

// searchUsers : 이름·이메일로 사용자 검색 (친구 추가 탭용)
export const searchUsers = async (q: string): Promise<Contact[]> => {
    const res = await api.get("/users/search", { params: { q } });
    return res.data;
};

// inviteToRoom : 채팅방에 다른 사용자 초대
export const inviteToRoom = async (roomId: string, userId: string): Promise<void> => {
    await api.post(`/chat/rooms/${roomId}/invite`, { user_id: userId });
};

// getOrCreateDm : 1:1 DM 방 찾기 또는 생성 (양쪽에서 호출해도 항상 같은 방 반환)
export const getOrCreateDm = async (friendId: string): Promise<ChatRoom> => {
    const res = await api.post("/chat/dm", { friend_id: friendId });
    return res.data;
};

// leaveRoom : 채팅방 나가기 (멤버에서 제거)
export const leaveRoom = async (roomId: string): Promise<void> => {
    await api.delete(`/chat/rooms/${roomId}/leave`);
};

// markRoomRead : 채팅방 읽음 처리 (last_read_at = now)
export const markRoomRead = async (roomId: string): Promise<void> => {
    await api.post(`/chat/rooms/${roomId}/read`);
};

// getRoomReadStatus : 방 멤버 전체의 읽음 시각 조회 { userId: isoString | null }
export const getRoomReadStatus = async (roomId: string): Promise<Record<string, string | null>> => {
    const res = await api.get(`/chat/rooms/${roomId}/read-status`);
    return res.data;
};

// getFriends : 내 친구 목록 조회
export const getFriends = async (): Promise<Contact[]> => {
    const res = await api.get("/friends");
    return res.data;
};

// addFriend : 친구 추가
export const addFriend = async (friendId: string): Promise<Contact> => {
    const res = await api.post("/friends", { friend_id: friendId });
    return res.data;
};

// updateFriendStatus : 친구 상태 변경 (active / hidden / blocked)
export const updateFriendStatus = async (friendId: string, status: "active" | "hidden" | "blocked"): Promise<void> => {
    await api.patch(`/friends/${friendId}`, { status });
};

// removeFriend : 친구 삭제
export const removeFriend = async (friendId: string): Promise<void> => {
    await api.delete(`/friends/${friendId}`);
};

// uploadChatImage : 채팅 이미지 업로드 — URL 반환
export const uploadChatImage = async (file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post("/chat/images", form, {
        headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data.url as string;
};
