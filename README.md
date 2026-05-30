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

## 유사 서비스 비교

| 기능 | **Neatly** | Notion | Evernote | Google Drive |
|------|:----------:|:------:|:--------:|:------------:|
| 문서 관리·폴더·태그 | O | O | O | O |
| 파일 업로드 (PDF·DOCX) | O | O | O | O |
| AI 자동 요약 | O | 유료 | X | X |
| AI 문서 Q&A | O | 유료 | X | X |
| AI 일간 브리핑 | O | X | X | X |
| Gmail 연동 및 이메일 자동 문서화 | O | X | X | X |
| 이메일 자동 동기화 | O | X | X | X |
| 실시간 채팅 | O | X | X | X |

> Gmail 이메일을 자동으로 문서로 변환하고 AI가 요약·브리핑까지 생성하는 점이 기존 서비스와의 핵심 차별점입니다.

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

---

## 트러블슈팅

| 문제 | 원인 | 해결 |
|------|------|------|
| Google OAuth "Missing code verifier" 오류 | 최신 `google-auth-oauthlib`이 PKCE를 자동 추가하는데, 서버사이드 리다이렉트 흐름에서 `code_verifier`를 요청 사이에 유지할 수 없음 | `google-auth-oauthlib` 대신 `requests_oauthlib.OAuth2Session`을 직접 사용해 PKCE 없이 인가 코드 흐름 처리 |
| Gmail 연결 후 1시간이 지나면 동기화가 silently 실패 | OAuth 콜백에서 `expires_at`을 DB에 저장하지 않아 `creds.expiry = None` → `creds.expired` 가 항상 `False` → 토큰 갱신 건너뜀 → Gmail API 401 → `except` 절이 0 반환 | 콜백에서 `token["expires_at"]`을 `gmail_token_expiry`에 저장, `refresh_if_expired()`에 `expiry is None` 조건 추가 |
| LLaMA 출력에 베트남어 자모·박스 문자 혼입 | Groq API가 간헐적으로 비정상 유니코드 출력 | `_sanitize_ai_output()` 후처리 함수 추가 — `unicodedata.category()`로 제어문자 필터링, 허용 문자셋 정규식 적용 |
| iOS Safari에서 앱 전체 흰 화면 | `window.Notification` 미지원 환경에서 Notification API 접근 시 런타임 오류 | `typeof Notification !== 'undefined'` 가드 추가, 최상단 `ErrorBoundary`로 치명적 오류 catch |
| WebSocket 재연결 시 메시지 중복 수신 | 네트워크 끊김 후 재연결 시 같은 사용자의 연결이 두 개 이상 유지됨 | `ConnectionManager.connect()`에서 동일 `user_id`의 기존 연결을 `close()` 후 교체 |
| 문서 목록 API에서 N+1 쿼리 발생 | 문서마다 태그 SELECT가 개별 실행 (문서 100개 = 쿼리 101회) | `docs_with_tags_batch()`로 전체 문서 ID를 IN 쿼리 1회로 태그 일괄 조회 후 메모리 매핑 (쿼리 수 N+1 → 2) |
| MySQL → PostgreSQL 마이그레이션 충돌 | `CHAR(36)` 타입 비교 불일치, `Enum` 타입명 미지정으로 PostgreSQL 충돌 | `String(36)`으로 교체, `Enum` 선언에 `name=` 파라미터 명시 |
| Vercel 배포 후 직접 URL 접근 시 404 | SPA 라우팅 미설정 | `vercel.json`에 모든 경로를 `index.html`로 rewrite 설정 추가 |
