const CLEAR_REJECTION_PATTERN = /背包中未找到|物品可用数量不足|已锁定|当前不可出售|参数无效|没有可出售|缺少|code=\d+/

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

export function normalizeBagMutationResponse(data, fallback = '操作失败') {
  const payload = data && typeof data === 'object' ? data : {}
  if (payload.ok === true)
    return payload

  const error = text(payload.error || payload.message, fallback)
  return {
    ...payload,
    ok: false,
    error,
    uncertain: payload.uncertain === true || error === 'API Timeout',
  }
}

export function bagMutationFailure(cause, fallback = '操作失败') {
  const payload = cause?.response?.data && typeof cause.response.data === 'object'
    ? cause.response.data
    : {}
  const status = Number(cause?.response?.status || 0)
  const error = text(payload.error || payload.message || cause?.message, fallback)
  const mayHaveReachedServer = status === 0 || status >= 500
  const clearlyRejected = CLEAR_REJECTION_PATTERN.test(error)

  return {
    ok: false,
    error,
    traceId: text(payload.traceId),
    status,
    uncertain: payload.uncertain === true || (mayHaveReachedServer && !clearlyRejected),
  }
}

function remainingCount(items, target) {
  const id = Number(target?.id || 0)
  const uid = Number(target?.uid || 0)
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    if (Number(item?.id || 0) !== id)
      return sum
    if (uid > 0 && Number(item?.uid || 0) !== uid)
      return sum
    return sum + Math.max(0, Number(item?.count || 0))
  }, 0)
}

export function bagMutationTargetsApplied(items, targets) {
  if (!Array.isArray(targets) || targets.length === 0)
    return false

  return targets.every((target) => {
    const beforeCount = Math.max(0, Number(target?.beforeCount || 0))
    const requestedCount = Math.max(1, Number(target?.requestedCount || 0))
    if (beforeCount < requestedCount)
      return false
    const expectedMaximum = Math.max(0, beforeCount - requestedCount)
    return remainingCount(items, target) <= expectedMaximum
  })
}
