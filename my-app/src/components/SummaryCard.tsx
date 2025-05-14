// Props : 이 컴포넌트가 받는 입력값 타입 정의
type Props = {
    title: string; // title : 카드 상단 제목
    value: string; // value : 카드 본문에 표시할 값
};

// 제목과 값을 카드 형태로 표시하는 재사용 컴포넌트
export default function SummaryCard({ title, value }: Props) {
    return (
        <div
            style={{
                padding: 15,
                border: '1px solid #eee',
                borderRadius: 10, // borderRadius : 모서리 둥글게
            }}
        >
            <h3>{title}</h3>
            <p>{value}</p>
        </div>
    );
}
