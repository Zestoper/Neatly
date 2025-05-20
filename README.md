# Neatly

AI 기반 문서 관리 플랫폼. 문서 업로드, Gmail 연동, AI 요약·브리핑, 실시간 채팅을 하나의 서비스에서 제공합니다.

---

## 주요 기능

### 문서 관리
- PDF, DOCX, TXT 파일 업로드 및 텍스트 추출
- 업로드 즉시 LLM 기반 AI 자동 요약 생성
- 폴더·태그로 문서 분류, 드래그 앤 드롭으로 이동
- 전문 검색 (제목·본문·태그)
- 휴지통 — 30일 후 자동 영구 삭제

### Gmail 연동
- Google OAuth 2.0 인증으로 Gmail 계정 연결
- 이메일을 문서로 변환 + AI 요약 자동 생성
- Premium 플랜: 2분마다 자동 동기화, 발신자 필터·스팸 관리
- Gmail 휴지통 이동 / 받은편지함 복원

### AI 기능
- **문서 요약**: 업로드 시 LLaMA 3로 3~4문장 요약
- **문서 Q&A**: 문서 본문을 컨텍스트로 자연어 질의응답 (Standard 이상)
- **AI 일간 브리핑**: 오늘 추가된 문서 전체를 분석해 핵심 요약 + 할 일 추천 (Premium)
- **폴더 브리핑**: 특정 폴더의 문서를 선택해 즉시 브리핑 생성

### 실시간 채팅
- WebSocket 기반 그룹 채팅 + 1:1 DM
- 온라인 상태 표시, 읽음 확인, 안읽은 메시지 뱃지
- 이미지 전송, 브라우저 푸시 알림

### 그 외
- 문서 작성 통계 인사이트 (일별·월별 차트)
- FREE / STANDARD / PREMIUM 플랜 시스템
- 친구 추가·숨김·차단 관리

---

## 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| Frontend | React 18, TypeScript, Vite, React Router v6 |
| Backend | FastAPI, SQLAlchemy, MySQL |
| AI | Groq API (LLaMA 3.3 70B / LLaMA 3.1 8B) |
| 인증 | JWT, Google OAuth 2.0 |
| 실시간 | WebSocket |
| 스케줄러 | APScheduler |
| 파일 파싱 | pdfplumber, python-docx |

---

## 아키텍처

```
my-app/                  # React 프론트엔드 (Vite)
  src/
    pages/               # 각 페이지 컴포넌트
    components/          # 공통 컴포넌트 (Sidebar, Layout, ChatModal 등)
    api/                 # Axios 기반 API 클라이언트
    context/             # Toast, Refresh 전역 상태

backend/                 # FastAPI 백엔드
  routers/
    auth.py              # 로그인·회원가입·JWT
    documents.py         # 문서 CRUD + AI 요약
    gmail.py             # Gmail API 연동
    email_sync.py        # 이메일 자동 동기화
    briefing.py          # AI 브리핑 생성
    ai.py                # 문서 Q&A
    chat.py              # WebSocket 채팅
    search.py            # 전문 검색
    friends.py           # 친구 관계
  scheduler.py           # 주기적 백그라운드 작업
  models.py              # DB 스키마 (SQLAlchemy)
  gmail_utils.py         # Gmail 자격증명 공통 유틸
```

---

## 실행 방법

### 사전 준비
- Python 3.11+
- Node.js 18+
- MySQL 8.0+
- [Groq API 키](https://console.groq.com)
- [Google Cloud OAuth 2.0 자격증명](https://console.cloud.google.com) (Gmail API 활성화 필요)

### 백엔드

```bash
cd backend
pip install -r requirements.txt
```

`.env` 파일 생성:

```env
DATABASE_URL=mysql+pymysql://user:password@localhost:3306/Neatly
SECRET_KEY=your-secret-key
GROQ_API_KEY=your-groq-api-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/gmail/callback
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:8000
```

```bash
python create_tables.py   # DB 테이블 생성
uvicorn main:app --reload
```

### 프론트엔드

```bash
cd my-app
npm install
```

`.env` 파일 생성:

```env
VITE_API_BASE_URL=http://localhost:8000
```

```bash
npm run dev
```

---

## 플랜별 기능

| 기능 | FREE | STANDARD | PREMIUM |
|------|:----:|:--------:|:-------:|
| 문서 업로드 (하루 3개) | O | O | O |
| 문서 업로드 (무제한) | | O | O |
| AI 문서 Q&A | | O | O |
| Gmail 연동·변환 | | O | O |
| AI 일간 브리핑 | | | O |
| Gmail 자동 동기화 | | | O |
| 발신자 필터 | | | O |

---

## API 문서

서버 실행 후 `http://localhost:8000/docs` 에서 Swagger UI로 확인할 수 있습니다.
