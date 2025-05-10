import { createContext, useCallback, useContext, useState } from "react";

type RefreshCtx = { refreshKey: number; bump: () => void };

const RefreshContext = createContext<RefreshCtx>({ refreshKey: 0, bump: () => {} });

export function RefreshProvider({ children }: { children: React.ReactNode }) {
    const [refreshKey, setRefreshKey] = useState(0);
    const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
    return (
        <RefreshContext.Provider value={{ refreshKey, bump }}>
            {children}
        </RefreshContext.Provider>
    );
}

export const useRefresh = () => useContext(RefreshContext);
