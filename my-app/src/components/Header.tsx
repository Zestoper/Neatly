// 대시보드 상단 헤더 컴포넌트
export default function Header() {
    return (
        <div
            style={{
                display: 'flex',               // flex : 자식 요소를 가로로 배치
                justifyContent: 'space-between', // space-between : 양 끝으로 분산 배치
                marginBottom: 20,
            }}
        >
            <h1>Good Morning 👋</h1>
            <button>Upload</button>
        </div>
    );
}
