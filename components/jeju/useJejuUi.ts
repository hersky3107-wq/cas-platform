'use client'

import { useEffect, useState } from 'react'
import {
  getJejuUiPack,
  resolveJejuLocale,
  type JejuLocale,
  type JejuUiPack,
} from '@/lib/jeju/ui-labels'

export function useJejuUi(): { locale: JejuLocale; t: JejuUiPack } {
  const [locale, setLocale] = useState<JejuLocale>('ko')

  useEffect(() => {
    const ui = typeof navigator !== 'undefined' ? navigator.language : null
    setLocale(resolveJejuLocale(ui))
  }, [])

  return { locale, t: getJejuUiPack(locale) }
}
