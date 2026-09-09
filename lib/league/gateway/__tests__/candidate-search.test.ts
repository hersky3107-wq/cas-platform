import { describe, expect, it } from 'vitest'
import { extractCandidateTokens, pickResolvedInCatalogOrder, scanCatalogMentions } from '../candidate-search'

describe('candidate search pick rule', () => {
  it('tokenizes a brief without letting list order decide the chips', () => {
    expect(extractCandidateTokens('Microsoft (MSFT), Apple (AAPL), Nvidia (NVDA)')).toEqual([
      'Microsoft',
      'MSFT',
      'Apple',
      'AAPL',
      'Nvidia',
      'NVDA',
    ])
  })

  it('picks at most 3 by catalog order, not search rank', () => {
    const catalog = ['AAPL', 'NVDA', 'TSLA']
    expect(pickResolvedInCatalogOrder(['TSLA', 'MSFT', 'NVDA', 'AAPL'], catalog)).toEqual(['AAPL', 'NVDA', 'TSLA'])
    expect(pickResolvedInCatalogOrder(['NVDA'], catalog)).toEqual(['NVDA'])
    expect(pickResolvedInCatalogOrder(['MSFT'], catalog)).toEqual([])
  })

  it('scans catalog tickers inside a prose brief', () => {
    expect(scanCatalogMentions('Traders watched NVDA and tsla overnight', ['AAPL', 'NVDA', 'TSLA'])).toEqual([
      'NVDA',
      'TSLA',
    ])
  })
})
