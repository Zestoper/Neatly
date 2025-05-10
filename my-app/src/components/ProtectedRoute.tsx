import { Navigate } from "react-router-dom"; // Navigate : 특정 경로로 리다이렉트하는 컴포넌트

// 토큰이 없으면 /login으로 보내는 인증 가드 컴포넌트
export default function ProtectedRoute({
    children, // children : 보호할 자식 컴포넌트
}: {
    children: React.ReactNode; // ReactNode : JSX, 문자열, null 등 렌더링 가능한 모든 타입
}) {
    const token = localStorage.getItem("token"); // token : 로그인 시 저장한 JWT

    if (!token) {
        return <Navigate to="/login" />; // Navigate : 로그인 페이지로 강제 이동
    }

    return children;
}
