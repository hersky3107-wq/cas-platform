'use client'

import { useCallback, useEffect, useState } from 'react'

export const HELP_LANG_STORAGE_KEY = 'aimani_help_lang'

/** All supported help languages. The original 6 are required in HelpModalContent;
 *  ZH-TW and AR are optional — existing content files need no edits. */
export type HelpLang = 'EN' | 'KO' | 'JA' | 'ZH-TW' | 'FR' | 'AR' | 'ES' | 'PT'

const HELP_LANGS: HelpLang[] = ['EN', 'KO', 'JA', 'ZH-TW', 'FR', 'AR', 'ES', 'PT']

/** Original 6 keys are required so existing content files compile unchanged.
 *  ZH-TW and AR are optional — modules that don't provide them simply omit them. */
export type HelpModalContent =
  Record<'EN' | 'KO' | 'JA' | 'ES' | 'FR' | 'PT', string> &
  Partial<Record<'ZH-TW' | 'AR', string>>

export interface HelpModalProps {
  content: HelpModalContent
  buttonClassName?: string
}

function isHelpLang(value: string): value is HelpLang {
  return (HELP_LANGS as readonly string[]).includes(value)
}

function readStoredHelpLang(): HelpLang {
  try {
    const raw = localStorage.getItem(HELP_LANG_STORAGE_KEY)
    if (raw && isHelpLang(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'EN'
}

function writeStoredHelpLang(lang: HelpLang): void {
  try {
    localStorage.setItem(HELP_LANG_STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
}

const RTL_LANGS: ReadonlySet<HelpLang> = new Set<HelpLang>(['AR'])

export default function HelpModal({ content, buttonClassName = '' }: HelpModalProps) {
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState<HelpLang>('EN')

  // Tabs: only show languages present in the passed content object.
  const availableLangs = HELP_LANGS.filter((l) => content[l] != null)

  useEffect(() => {
    const stored = readStoredHelpLang()
    // If stored lang has no content for this module, fall back to EN.
    setLang(content[stored] != null ? stored : 'EN')
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const selectLang = useCallback((next: HelpLang) => {
    setLang(next)
    writeStoredHelpLang(next)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  const isRtl = RTL_LANGS.has(lang)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open help"
        className={[
          'fixed top-20 right-4 z-[90] flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-full',
          'border border-cyan-300/50 bg-cyan-500 text-lg font-bold text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.55)]',
          'animate-pulse transition hover:bg-cyan-400 hover:animate-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300',
          buttonClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        ?
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-modal-title"
          onClick={close}
        >
          <div
            className="relative flex max-h-[80vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1629] shadow-2xl ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <h2 id="help-modal-title" className="text-lg font-semibold text-white">
                Help
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close help"
                className="rounded-lg p-1.5 text-xl leading-none text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            </div>

            <div
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2"
              role="tablist"
              aria-label="Help language"
            >
              {availableLangs.map((code) => (
                <button
                  key={code}
                  type="button"
                  role="tab"
                  aria-selected={lang === code}
                  onClick={() => selectLang(code)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    lang === code
                      ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/40'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p
                dir={isRtl ? 'rtl' : 'ltr'}
                className={`whitespace-pre-wrap text-sm leading-relaxed text-slate-200${isRtl ? ' text-right' : ''}`}
              >
                {content[lang]}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
