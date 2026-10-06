/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepAnalysis } from '../../../components/league/DeepAnalysis'

const ROUND_ID = 'd1a3d106-a823-45d8-bc5b-7b066ff4efc5'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('DeepAnalysis click path', () => {
  let root: Root | null = null

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  async function renderPanel(onPost: (body: unknown) => unknown) {
    const posts: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/league/context')) {
          return json({
            profileLocale: 'ko',
            acceptLanguage: null,
            ipCountry: 'US',
            declaredCountry: null,
            isAdmin: false,
          })
        }
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as unknown
          posts.push(body)
          return json(onPost(body))
        }
        if (url.includes('/api/league/deep-')) return json({ exists: false })
        return json({})
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        createElement(DeepAnalysis, {
          roundId: ROUND_ID,
          category: 'stock',
          colorBucket: 'green',
        }),
      )
    })
    const button = () => host.querySelector('[data-testid="deep-report-start"]') as HTMLButtonElement | null
    for (let i = 0; i < 8 && !button()?.textContent?.includes('AI 심층 리포트'); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    return { host, posts, button: button()! }
  }

  it('POSTs the unlocked round and moves the report to the first stage', async () => {
    const { host, posts, button } = await renderPanel(() => ({
      ok: true,
      done: false,
      kind: 'report',
      stage: 'research',
    }))
    expect(button.textContent).toContain('AI 심층 리포트')
    expect(button.disabled).toBe(false)

    await act(async () => {
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(posts).toEqual([{ roundId: ROUND_ID, locale: 'ko' }])
    const first = host.querySelector('[data-testid="deep-stage-strip"] li')
    expect(first?.getAttribute('data-active')).toBe('true')
    expect(first?.textContent).toContain('research')
    expect(host.textContent).toContain('조사 중')
  })

  it('shows the refunded failure and a retry', async () => {
    const { host, button } = await renderPanel(() => ({
      ok: false,
      done: true,
      refunded: true,
    }))

    await act(async () => {
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(host.textContent).toContain('분석에 실패해 크레딧을 환불해 드렸습니다')
    const retry = [...host.querySelectorAll('button')].find((el) => el.textContent?.includes('다시 시도'))
    expect(retry).toBeTruthy()
    expect(host.querySelector('[data-testid="deep-working"]')).toBeNull()
  })
})
