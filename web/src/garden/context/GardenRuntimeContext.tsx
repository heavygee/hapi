import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type GardenRuntimeContextValue = {
    focusedId: string | null
    setFocusedId: (id: string | null | ((prev: string | null) => string | null)) => void
    isPresenting: boolean
    setIsPresenting: (presenting: boolean) => void
}

const GardenRuntimeContext = createContext<GardenRuntimeContextValue | null>(null)

export function GardenRuntimeProvider({ children }: { children: ReactNode }) {
    const [focusedId, setFocusedId] = useState<string | null>(null)
    const [isPresenting, setIsPresentingState] = useState(false)
    const setIsPresenting = useCallback((presenting: boolean) => {
        setIsPresentingState(presenting)
    }, [])

    const value = useMemo(
        () => ({ focusedId, setFocusedId, isPresenting, setIsPresenting }),
        [focusedId, isPresenting, setIsPresenting]
    )

    return (
        <GardenRuntimeContext.Provider value={value}>
            {children}
        </GardenRuntimeContext.Provider>
    )
}

export function useGardenRuntime(): GardenRuntimeContextValue {
    const ctx = useContext(GardenRuntimeContext)
    if (!ctx) {
        throw new Error('useGardenRuntime must be used within GardenRuntimeProvider')
    }
    return ctx
}

export function useGardenFocus() {
    const { focusedId, setFocusedId } = useGardenRuntime()
    return { focusedId, setFocusedId }
}
