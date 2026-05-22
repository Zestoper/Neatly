import {
    BrowserRouter, // BrowserRouter : URL 기반 라우팅을 가능하게 하는 컨테이너
    Routes,        // Routes : 여러 Route 중 현재 URL에 맞는 것 하나만 렌더링
    Route,         // Route : path와 컴포넌트를 매핑하는 단위
} from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Calendar from "./pages/Calendar";
import Documents from "./pages/Documents";
import Search from "./pages/Search";
import Trash from "./pages/Trash";
import DocumentDetail from "./pages/DocumentDetail";
import DocumentNew from "./pages/DocumentNew";
import Settings from "./pages/Settings";
import Insights from "./pages/Insights";
import Plans from "./pages/Plans";
import Emails from "./pages/Emails";
import EmailDetail from "./pages/EmailDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProtectedRoute from "./components/ProtectedRoute"; // ProtectedRoute : 로그인 여부를 확인하는 래퍼 컴포넌트
import Layout from "./components/Layout";               // Layout : 사이드바 + 메인 영역 레이아웃
import { ToastProvider } from "./context/ToastContext";
import { RefreshProvider } from "./context/RefreshContext";

// 앱 전체 라우팅 설정
export default function App() {
    return (
        <RefreshProvider>
        <ToastProvider>
        <BrowserRouter>
            <Routes>
                {/* path="/" : 루트 경로 — 로그인한 사용자만 접근 가능 */}
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Dashboard />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/calendar"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Calendar />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/documents"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Documents />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/documents/new"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <DocumentNew />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/documents/:id"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <DocumentDetail />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/insights"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Insights />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/settings"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Settings />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/plans"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Plans />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/emails"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Emails />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/emails/:id"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <EmailDetail />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/search"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Search />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/trash"
                    element={
                        <ProtectedRoute>
                            <Layout>
                                <Trash />
                            </Layout>
                        </ProtectedRoute>
                    }
                />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="*" element={
                    <div style={{ textAlign: "center", padding: "4rem" }}>
                        <h2>페이지를 찾을 수 없습니다.</h2>
                    </div>
                } />
            </Routes>
        </BrowserRouter>
        </ToastProvider>
        </RefreshProvider>
    );
}
