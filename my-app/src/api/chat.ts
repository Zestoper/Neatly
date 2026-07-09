import { api } from "./client";

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

export type ChatMessage = {
    id: string;
    user_id: string;
    user_name: string;
    content: string;
    created_at: string;
};

export const getRooms = async (): Promise<ChatRoom[]> => {
    const res = await api.get("/chat/rooms");
    return res.data;
};

export const createRoom = async (name: string, documentId?: string): Promise<ChatRoom> => {
    const res = await api.post("/chat/rooms", {
        name,
        document_id: documentId ?? null,
    });
    return res.data;
};

export const joinRoom = async (roomId: string): Promise<ChatRoom> => {
    const res = await api.post(`/chat/rooms/${roomId}/join`);
    return res.data;
};

export const getMessages = async (roomId: string): Promise<ChatMessage[]> => {
    const res = await api.get(`/chat/rooms/${roomId}/messages`);
    return res.data;
};

export type Contact = {
    id: string;
    name: string;
    email: string;
    status?: "active" | "hidden" | "blocked";
};

export const getContacts = async (): Promise<Contact[]> => {
    const res = await api.get("/chat/contacts");
    return res.data;
};

export const searchUsers = async (q: string): Promise<Contact[]> => {
    const res = await api.get("/users/search", { params: { q } });
    return res.data;
};

export const inviteToRoom = async (roomId: string, userId: string): Promise<void> => {
    await api.post(`/chat/rooms/${roomId}/invite`, { user_id: userId });
};

export const getOrCreateDm = async (friendId: string): Promise<ChatRoom> => {
    const res = await api.post("/chat/dm", { friend_id: friendId });
    return res.data;
};

export const leaveRoom = async (roomId: string): Promise<void> => {
    await api.delete(`/chat/rooms/${roomId}/leave`);
};

export const markRoomRead = async (roomId: string): Promise<void> => {
    await api.post(`/chat/rooms/${roomId}/read`);
};

export const getRoomReadStatus = async (roomId: string): Promise<Record<string, string | null>> => {
    const res = await api.get(`/chat/rooms/${roomId}/read-status`);
    return res.data;
};

export const getFriends = async (): Promise<Contact[]> => {
    const res = await api.get("/friends");
    return res.data;
};

export const addFriend = async (friendId: string): Promise<Contact> => {
    const res = await api.post("/friends", { friend_id: friendId });
    return res.data;
};

export const updateFriendStatus = async (friendId: string, status: "active" | "hidden" | "blocked"): Promise<void> => {
    await api.patch(`/friends/${friendId}`, { status });
};

export const removeFriend = async (friendId: string): Promise<void> => {
    await api.delete(`/friends/${friendId}`);
};

export const uploadChatImage = async (file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post("/chat/images", form, {
        headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data.url as string;
};
