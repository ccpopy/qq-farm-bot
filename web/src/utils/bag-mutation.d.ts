export interface BagMutationResult {
  ok: boolean
  data?: Record<string, unknown> | null
  error?: string
  traceId?: string
  status?: number
  uncertain?: boolean
  [key: string]: unknown
}

export interface BagMutationTarget {
  id: number
  uid: number
  beforeCount: number
  requestedCount: number
}

export function normalizeBagMutationResponse(data: unknown, fallback?: string): BagMutationResult
export function bagMutationFailure(cause: unknown, fallback?: string): BagMutationResult
export function bagMutationTargetsApplied(items: unknown[], targets: BagMutationTarget[]): boolean
