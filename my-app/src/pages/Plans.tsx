import { useEffect, useState } from "react";
import { getMe } from "../api/auth";
import { updatePlan } from "../api/users";
import { useToast } from "../context/ToastContext";
import styles from "./Plans.module.css";

// Plan : 플랜 이름에 쓸 수 있는 값을 딱 세 가지로 제한하는 타입
// 예: const p: Plan = "FREE"  → 가능
//     const p: Plan = "VIP"   → 오류 (허용 안 됨)
type Plan = "FREE" | "STANDARD" | "PREMIUM";

// PLANS : 화면에 표시할 플랜 정보 목록 (배열)
// 컴포넌트 바깥에 두는 이유 : 안에 두면 렌더링될 때마다 새로 만들어짐 — 바깥에 두면 한 번만 만들어짐
const PLANS = [
    {
        id: "FREE" as Plan,
        name: "Free",
        price: "무료",
        priceSub: "",
        features: [
            "문서 작성 (하루 3개)",
            "AI 요약 잠금",
            "폴더 정리 잠금",
        ],
        highlighted: false,
    },
    {
        id: "STANDARD" as Plan,
        name: "Standard",
        price: "9,900원",
        priceSub: "/ 월",
        features: [
            "문서 작성 무제한",
            "폴더 정리",
            "AI 요약",
            "AI 질문",
        ],
        highlighted: true,
    },
    {
        id: "PREMIUM" as Plan,
        name: "Premium",
        price: "19,900원",
        priceSub: "/ 월",
        features: [
            "Standard 모든 기능",
            "AI 일간 브리핑",
            "Gmail 자동 정리",
            "우선 지원",
        ],
        highlighted: false,
    },
];

export default function Plans() {
    const { showToast } = useToast();

    const [currentPlan, setCurrentPlan] = useState<Plan>("FREE");
    const [changing, setChanging] = useState(false);

    // useEffect : 컴포넌트가 화면에 처음 나타날 때 한 번 실행되는 코드
    useEffect(() => {
        // getMe() : 서버에서 "나는 누구인가?"를 물어보는 API 호출
        // .then((data) => ...) : 서버 응답이 오면 data에 담아서 실행
        getMe().then((data) => {
            setCurrentPlan(data.plan);
            // setCurrentPlan : 서버에서 받아온 실제 플랜으로 상태 업데이트

            localStorage.setItem("plan", data.plan);
            // localStorage.setItem : 브라우저에 plan 값을 저장
            // 이 페이지를 열 때마다 서버 기준으로 맞춰줌 — 오래된 값이 남아있을 수 있어서
        });
    }, []);
    // [] : 의존성 배열이 비어있으면 "처음 한 번만 실행" 이라는 뜻
    // 만약 [currentPlan] 이었다면 currentPlan이 바뀔 때마다 실행됨

    // handleChangePlan : 버튼을 눌렀을 때 플랜을 변경하는 함수
    // plan : 누른 버튼의 플랜 (예: "STANDARD")
    const handleChangePlan = async (plan: Plan) => {
        if (plan === currentPlan) return;
        // 현재 플랜과 같은 버튼을 눌렀으면 아무 것도 하지 않고 종료
        // 버튼을 disabled로 막지만, 혹시 모를 경우를 대비한 이중 방어

        setChanging(true);  // 로딩 시작 — 버튼이 "변경 중..."으로 바뀜

        try {
            await updatePlan(plan);
            localStorage.setItem("plan", plan);
            setCurrentPlan(plan);
            showToast(`${plan.charAt(0) + plan.slice(1).toLowerCase()} 플랜으로 변경되었습니다.`);
        } catch {
            showToast("플랜 변경에 실패했습니다.", "error");
        } finally {
            setChanging(false);
        }
    };

    return (
        <div className={styles.container}>
            <h1 className={styles.heading}>플랜</h1>
            <p className={styles.subheading}>원하는 플랜을 선택하세요.</p>

            {/* cards : 플랜 카드 세 개를 가로로 나열하는 컨테이너 */}
            <div className={styles.cards}>

                {/* PLANS.map : PLANS 배열을 순회하며 각 플랜마다 카드 하나씩 렌더링 */}
                {PLANS.map((plan) => {

                    // isCurrent : 이 카드의 플랜이 현재 내 플랜과 같은지 여부
                    // 예: currentPlan이 "STANDARD"이고 plan.id도 "STANDARD"이면 true
                    const isCurrent = plan.id === currentPlan;

                    return (
                        <div
                            key={plan.id}
                            // key : React가 목록의 각 항목을 구별할 때 쓰는 고유 식별자
                            // 배열을 map으로 렌더링할 때 반드시 필요

                            className={[
                                styles.card,
                                plan.highlighted ? styles.cardHighlighted : "",
                                isCurrent ? styles.cardCurrent : "",
                            ].join(" ")}
                            // className 조합 방법 :
                            // 1. 기본 스타일 styles.card 항상 적용
                            // 2. highlighted가 true이면 styles.cardHighlighted 추가 (추천 플랜 테두리)
                            // 3. isCurrent이면 styles.cardCurrent 추가 (현재 플랜 배경)
                            // .join(" ") : 배열을 공백으로 이어붙여 문자열로 만듦
                            // 예: "card cardHighlighted cardCurrent"
                        >
                            {/* 현재 플랜 배지 — isCurrent가 true일 때만 표시 */}
                            {isCurrent && (
                                <span className={styles.currentBadge}>현재 플랜</span>
                            )}

                            <p className={styles.planName}>{plan.name}</p>
                            <p className={styles.price}>{plan.price}</p>
                            {plan.priceSub && <p className={styles.priceSub}>{plan.priceSub}</p>}

                            {/* features 목록을 ul > li 로 렌더링 */}
                            <ul className={styles.features}>
                                {plan.features.map((feature) => (
                                    <li key={feature} className={styles.feature}>
                                        {feature}
                                    </li>
                                ))}
                            </ul>

                            <button
                                className={isCurrent ? styles.currentButton : styles.changeButton}
                                // isCurrent이면 회색 비활성 버튼, 아니면 검정 활성 버튼

                                onClick={() => handleChangePlan(plan.id)}
                                // 버튼 클릭 시 이 카드의 plan.id를 전달해서 플랜 변경 시도

                                disabled={isCurrent || changing}
                                // disabled 조건 :
                                // 1. isCurrent — 이미 현재 플랜이면 누를 필요 없음
                                // 2. changing — 다른 플랜 변경 요청이 진행 중이면 막음
                            >
                                {isCurrent
                                    ? "현재 플랜"
                                    : changing
                                    ? "변경 중..."
                                    : "이 플랜으로 변경"
                                }
                                {/*
                                    버튼 텍스트 분기 (삼항 연산자 중첩) :
                                    - isCurrent가 true이면        → "현재 플랜"
                                    - isCurrent는 false인데 changing이 true이면 → "변경 중..."
                                    - 둘 다 false이면              → "이 플랜으로 변경"
                                */}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
