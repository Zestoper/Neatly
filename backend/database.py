import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")

# SQLAlchemy 2.1부터 "postgresql://"의 기본 드라이버가 psycopg2 -> psycopg(v3)로 바뀌었다.
# requirements에는 psycopg2-binary만 있으므로 드라이버를 명시해서 고정한다.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgresql://"):]

engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=1800,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

if __name__ == "__main__":

    try:
        with engine.connect() as connection:
            result = connection.execute("SELECT 1")
            print("DB 연결 성공!", result.fetchone())
    except Exception as e:
        print("DB 연결 실패:", e)
