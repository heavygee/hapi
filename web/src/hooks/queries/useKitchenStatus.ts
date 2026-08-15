import { useQuery } from '@tanstack/react-query'
import type { KitchenStatusResponse } from '@hapi/protocol/apiTypes'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

const KITCHEN_STATUS_POLL_MS = 30_000

/**
 * Fork-only estate affordance: hub-host soup/mirror hygiene. Silent-fail by
 * design — a 403 (shared/non-owner namespace) or a missing script on non-fork
 * installs both just mean "nothing to show," not an error worth surfacing.
 */
export function useKitchenStatus(api: ApiClient | null): {
    status: KitchenStatusResponse | null
} {
    const query = useQuery({
        queryKey: queryKeys.kitchenStatus,
        queryFn: async () => {
            if (!api) {
                return { available: false } as const
            }
            try {
                return await api.getKitchenStatus()
            } catch {
                return { available: false } as const
            }
        },
        enabled: Boolean(api),
        staleTime: KITCHEN_STATUS_POLL_MS,
        refetchInterval: KITCHEN_STATUS_POLL_MS,
        retry: false
    })

    return { status: query.data ?? null }
}
