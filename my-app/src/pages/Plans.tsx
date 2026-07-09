import { useEffect, useState } from "react";
import { getMe } from "../api/auth";
import { updatePlan } from "../api/users";
import { useToast } from "../context/ToastContext";
import styles from "./Plans.module.css";

type Plan = "FREE" | "STANDARD" | "PREMIUM";

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

    useEffect(() => {

        getMe().then((data) => {
            setCurrentPlan(data.plan);

            localStorage.setItem("plan", data.plan);

        });
    }, []);

    const handleChangePlan = async (plan: Plan) => {
        if (plan === currentPlan) return;

        setChanging(true);

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

            <div className={styles.cards}>

                {PLANS.map((plan) => {

                    const isCurrent = plan.id === currentPlan;

                    return (
                        <div
                            key={plan.id}

                            className={[
                                styles.card,
                                plan.highlighted ? styles.cardHighlighted : "",
                                isCurrent ? styles.cardCurrent : "",
                            ].join(" ")}

                        >

                            {isCurrent && (
                                <span className={styles.currentBadge}>현재 플랜</span>
                            )}

                            <p className={styles.planName}>{plan.name}</p>
                            <p className={styles.price}>{plan.price}</p>
                            {plan.priceSub && <p className={styles.priceSub}>{plan.priceSub}</p>}

                            <ul className={styles.features}>
                                {plan.features.map((feature) => (
                                    <li key={feature} className={styles.feature}>
                                        {feature}
                                    </li>
                                ))}
                            </ul>

                            <button
                                className={isCurrent ? styles.currentButton : styles.changeButton}

                                onClick={() => handleChangePlan(plan.id)}

                                disabled={isCurrent || changing}

                            >
                                {isCurrent
                                    ? "현재 플랜"
                                    : changing
                                    ? "변경 중..."
                                    : "이 플랜으로 변경"
                                }

                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
