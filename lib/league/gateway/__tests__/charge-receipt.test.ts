import { describe, expect, it } from 'vitest'
import { consumeGatewayReceipt, issueGatewayReceipt } from '../charge-receipt'

describe('gateway charge receipt', () => {
  it('is one-shot and bound to user + instrument + horizon', () => {
    const id = issueGatewayReceipt('u1', 'AAPL', '1d')
    expect(consumeGatewayReceipt(id, 'u2', 'AAPL', '1d')).toBe(false)
    expect(consumeGatewayReceipt(id, 'u1', 'NVDA', '1d')).toBe(false)
    expect(consumeGatewayReceipt(id, 'u1', 'AAPL', '1d')).toBe(true)
    expect(consumeGatewayReceipt(id, 'u1', 'AAPL', '1d')).toBe(false)
  })
})
