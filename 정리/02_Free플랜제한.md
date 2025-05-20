# Free 플랜 하루 3개 문서 제한

## 어떤 기능인가?

Free 플랜 사용자가 하루(UTC 자정 기준)에 3개를 초과해서 문서를 만들거나
파일을 업로드하려 하면 **403 오류**를 반환해 막습니다.

> 기존 코드에 TODO 주석으로 비활성화된 채 있던 로직을 실제로 켰고,
> 파일 업로드(`/documents/upload`) 엔드포인트에도 동일하게 적용했습니다.

---

## 수정한 파일

### `backend/routers/documents.py` — `POST /documents` (문서 직접 작성)

```python
# Free 플랜 : 하루 3개 제한 — 오늘 자정(UTC) 이후 생성된 문서 수 확인
if current_user.plan == "FREE":
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    today_count = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.created_at >= today_start,
        Document.deleted_at == None,  # 소프트 삭제된 문서는 카운트 제외
    ).count()
    if today_count >= 3:
        raise HTTPException(
            status_code=403,
            detail="오늘 작성 가능한 문서 수를 초과했습니다. (Free 플랜: 하루 3개)"
        )
```

### `backend/routers/documents.py` — `POST /documents/upload` (파일 업로드)

```python
# Free 플랜 : 업로드도 하루 3개 제한에 포함
if current_user.plan == "FREE":
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    today_count = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.created_at >= today_start,
        Document.deleted_at == None,
    ).count()
    if today_count >= 3:
        raise HTTPException(
            status_code=403,
            detail="오늘 작성 가능한 문서 수를 초과했습니다. (Free 플랜: 하루 3개)"
        )
```

---

## 프론트엔드 처리

Documents 페이지(`Documents.tsx`)는 파일 업로드 실패 시 이미 이렇게 처리합니다:

```typescript
} catch (err: any) {
    // err.response.data.detail = 서버가 보낸 오류 메시지
    setUploadError(err.response?.data?.detail ?? "업로드 중 오류가 발생했습니다.");
}
```

403이 오면 `"오늘 작성 가능한 문서 수를 초과했습니다."` 문구가
업로드 영역 아래에 빨간 텍스트로 표시됩니다.

---

## 제한 기준 요약

| 항목 | 내용 |
|------|------|
| 대상 플랜 | FREE 플랜만 적용 |
| 하루 기준 | UTC 자정 0시 ~ 23시 59분 |
| 제한 횟수 | 3개 (문서 작성 + 파일 업로드 합산) |
| 소프트 삭제 | 삭제한 문서는 카운트에서 제외 |
| 오류 코드 | HTTP 403 Forbidden |
