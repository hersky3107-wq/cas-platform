/**
 * Short-lived in-process receipt so generate-stream does not charge a second
 * time after the gateway already deducted. 5-minute TTL; one consume.
 */

type Receipt = {
  userId: string
  instrument: string
  horizon: string
  expiresAt: number
}

const TTL_MS = 5 * 60 * 1000
const receipts = new Map<string, Receipt>()

function gc(now: number) {
  for (const [id, row] of receipts) {
    if (row.expiresAt <= now) receipts.delete(id)
  }
}

export function issueGatewayReceipt(userId: string, instrument: string, horizon: string, now = Date.now()): string {
  gc(now)
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  receipts.set(id, { userId, instrument, horizon, expiresAt: now + TTL_MS })
  return id
}

export function consumeGatewayReceipt(
  id: string,
  userId: string,
  instrument: string,
  horizon: string,
  now = Date.now(),
): boolean {
  const row = receipts.get(id)
  if (!row) return false
  if (row.expiresAt <= now) {
    receipts.delete(id)
    return false
  }
  if (row.userId !== userId || row.instrument !== instrument || row.horizon !== horizon) return false
  receipts.delete(id)
  return true
}
