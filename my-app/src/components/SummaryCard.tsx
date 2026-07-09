type Props = {
    title: string;
    value: string;
};

export default function SummaryCard({ title, value }: Props) {
    return (
        <div
            style={{
                padding: 15,
                border: '1px solid #eee',
                borderRadius: 10,
            }}
        >
            <h3>{title}</h3>
            <p>{value}</p>
        </div>
    );
}
