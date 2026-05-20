import os                                # os : 환경변수를 읽기 위해 사용
from sqlalchemy import create_engine    # create_engine : DB 연결 엔진 생성 함수
from sqlalchemy.orm import sessionmaker # sessionmaker : DB 세션 팩토리 생성 함수
from dotenv import load_dotenv          # load_dotenv : .env 파일을 환경변수로 로드

load_dotenv() # .env 파일 읽기

DATABASE_URL = os.getenv("DATABASE_URL") # DATABASE_URL : DB 접속 주소 (예: mysql://user:pw@host/db)

engine = create_engine(
    DATABASE_URL,
    pool_size=10,        # 상시 유지할 커넥션 수
    max_overflow=20,     # pool_size 초과 시 추가로 열 수 있는 커넥션 수
    pool_pre_ping=True,  # 쿼리 전 커넥션 생존 여부 확인 — 끊긴 커넥션 자동 교체
    pool_recycle=1800,   # 30분마다 커넥션 재생성
)

# autocommit=False : 명시적 commit() 호출 시에만 DB에 저장
# autoflush=False  : 명시적 flush() 없이는 DB에 반영 안 됨
# bind=engine      : 위에서 만든 엔진에 연결
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# FastAPI의 Depends()에 넘겨 쓰는 DB 세션 제공 함수
# yield : 세션을 넘긴 뒤 요청 완료 후 finally로 close() 보장
def get_db():
    db = SessionLocal() # db : 요청마다 새로 만드는 DB 세션
    try:
        yield db
    finally:
        db.close()

if __name__ == "__main__":
    # 이 파일을 직접 실행하면 DB 연결을 테스트
    try:
        with engine.connect() as connection:
            result = connection.execute("SELECT 1")
            print("DB 연결 성공!", result.fetchone())
    except Exception as e:
        print("DB 연결 실패:", e)
