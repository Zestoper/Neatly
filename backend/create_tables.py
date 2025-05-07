# models.py에 정의된 모든 테이블을 DB에 실제로 생성하는 스크립트
from models import Base     # Base : 모든 모델이 상속하는 기본 클래스
from database import engine # engine : DB와 연결하는 SQLAlchemy 엔진

# metadata.create_all : Base에 등록된 모든 모델을 DB 테이블로 생성
# bind=engine : 어떤 DB에 생성할지 지정
Base.metadata.create_all(bind=engine)
