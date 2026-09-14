import { describe, expect, it } from 'vitest'
import { consumeGatewayReceipt, issueGatewayReceipt, type ReceiptDb } from '../charge-receipt'

/**
 * Fake `league_gateway_receipts` with real conditional-UPDATE semantics: the
 * row store is shared state (the "database"), and consume only wins when the
 * WHERE predicate matches — exactly how the Postgres row behaves across two
 * serverless isolates. The old in-process-Map implementation double-charged
 * precisely because isolate B could not see isolate A's Map; here any number
 * of call sites share the row, and the flip is still one-shot.
 */
type Row = {
  id: string
  user_id: string
  instrument: string
  horizon: string
  expires_at: string
  consumed_at: string | null
}

function fakeReceiptDb(): { db: ReceiptDb; rows: Map<string, Row> } {
  const rows = new Map<string, Row>()

  const db = {
    from(table: string) {
      if (table !== 'league_gateway_receipts') throw new Error(`unexpected table ${table}`)
      return {
        insert(payload: Omit<Row, 'id' | 'consumed_at'>) {
          return {
            select(_cols: string) {
              return {
                async single() {
                  const id = crypto.randomUUID()
                  rows.set(id, { ...payload, id, consumed_at: null })
                  return { data: { id }, error: null }
                },
              }
            },
          }
        },
        update(patch: Partial<Row>) {
          const filters: Array<(row: Row) => boolean> = []
          const chain = {
            eq(col: keyof Row, value: string) {
              filters.push((row) => row[col] === value)
              return chain
            },
            is(col: keyof Row, value: null) {
              filters.push((row) => row[col] === value)
              return chain
            },
            gt(col: keyof Row, value: string) {
              filters.push((row) => (row[col] as string) > value)
              return chain
            },
            async select(_cols: string) {
              const matched = [...rows.values()].filter((row) => filters.every((f) => f(row)))
              for (const row of matched) Object.assign(row, patch)
              return { data: matched.map((row) => ({ id: row.id })), error: null }
            },
          }
          return chain
        },
      }
    },
  }

  return { db: db as unknown as ReceiptDb, rows }
}

describe('gateway charge receipt (league_gateway_receipts-backed)', () => {
  it('a receipt cannot be consumed twice, even from a different call site', async () => {
    const { db } = fakeReceiptDb()
    const id = await issueGatewayReceipt('u1', 'AAPL', '1d', db)

    // First consume wins; the conditional UPDATE flips consumed_at.
    expect(await consumeGatewayReceipt(id, 'u1', 'AAPL', '1d', db)).toBe(true)
    // Second consume — same isolate or another one, it's the same DB row —
    // finds consumed_at already set and loses. This is the double-charge fix.
    expect(await consumeGatewayReceipt(id, 'u1', 'AAPL', '1d', db)).toBe(false)
  })

  it('is bound to user + instrument + horizon', async () => {
    const { db } = fakeReceiptDb()
    const id = await issueGatewayReceipt('u1', 'AAPL', '1d', db)

    expect(await consumeGatewayReceipt(id, 'u2', 'AAPL', '1d', db)).toBe(false)
    expect(await consumeGatewayReceipt(id, 'u1', 'NVDA', '1d', db)).toBe(false)
    expect(await consumeGatewayReceipt(id, 'u1', 'AAPL', '7d', db)).toBe(false)
    // The failed attempts must not have burned the receipt.
    expect(await consumeGatewayReceipt(id, 'u1', 'AAPL', '1d', db)).toBe(true)
  })

  it('expires after its TTL', async () => {
    const { db } = fakeReceiptDb()
    const issuedAt = Date.parse('2026-09-14T00:00:00Z')
    const id = await issueGatewayReceipt('u1', 'AAPL', '1d', db, issuedAt)

    const pastTtl = issuedAt + 5 * 60 * 1000 + 1
    expect(await consumeGatewayReceipt(id, 'u1', 'AAPL', '1d', db, pastTtl)).toBe(false)
    // And it stays dead on every later attempt.
    expect(await consumeGatewayReceipt(id, 'u1', 'AAPL', '1d', db, pastTtl + 60_000)).toBe(false)
    // Within the TTL it would have worked — proving expiry was the reason.
    expect(await consumeGatewayReceipt(id, 'u1', 'AAPL', '1d', db, issuedAt + 1_000)).toBe(true)
  })

  it('rejects a malformed id without touching the database', async () => {
    const db = {
      from() {
        throw new Error('must not reach the db for a malformed id')
      },
    } as unknown as ReceiptDb
    expect(await consumeGatewayReceipt('receipt_abc', 'u1', 'AAPL', '1d', db)).toBe(false)
    expect(await consumeGatewayReceipt('', 'u1', 'AAPL', '1d', db)).toBe(false)
  })
})
