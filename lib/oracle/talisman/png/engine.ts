export type TalismanPngEngine = 'native' | 'wasm'

export const TALISMAN_PNG_ENGINE: TalismanPngEngine = 'native'

export async function loadResvg(): Promise<{
  Resvg: new (svg: string, opts: Record<string, unknown>) => { render: () => { asPng: () => Buffer } }
  engine: TalismanPngEngine
}> {
  try {
    const native = await import('@resvg/resvg-js')
    return { Resvg: native.Resvg, engine: 'native' }
  } catch {
    const wasm = await import('@resvg/resvg-wasm')
    const init = (wasm as { initWasm?: (input?: unknown) => Promise<void> }).initWasm
    if (init) await init()
    return { Resvg: wasm.Resvg as never, engine: 'wasm' }
  }
}
