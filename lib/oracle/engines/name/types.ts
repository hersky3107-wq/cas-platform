/** BCP-47-ish locale tag. Only the 'ko' / 'ja' / 'zh*' branches are meaningful here. */
export type NameLocale = string
export type StrokeConvention = 'kangxi' | 'modern'

export type NameInput = {
  surname: string
  givenName: string
  locale: NameLocale
  /** Hanja only. Defaults to `kangxi`; ignored for Korean names. */
  strokeConvention?: StrokeConvention
}

export type SuriLabel = '대길' | '길' | '평' | '흉' | '대흉'

export type SuriEntry = {
  number: number
  label: SuriLabel
  keyword: string
}

export type Gyeok = {
  cheon: number
  in: number
  ji: number
  oe: number
  chong: number
}

export type GyeokSuri = {
  cheon: SuriEntry
  in: SuriEntry
  ji: SuriEntry
  oe: SuriEntry
  chong: SuriEntry
}

export type YinYangToken = 'yang' | 'yin'

export type YinYangResult = {
  pattern: YinYangToken[]
  balanced: boolean
}

export type FiveElement = 'wood' | 'fire' | 'earth' | 'metal' | 'water'

export type ElementRelation = 'generating' | 'overcoming' | 'same'

export type FiveElementsResult = {
  cheon: FiveElement
  in: FiveElement
  ji: FiveElement
  cheonIn: ElementRelation
  inJi: ElementRelation
}

export type NameLimitation = 'use_numerology_instead'

export type NameReadingDetails = {
  strokeConvention: StrokeConvention
  strokes: number[]
  gyeok: Gyeok
  numerology81: GyeokSuri
  yinYang: YinYangResult
  fiveElements: FiveElementsResult
}

export type AlternateNameReading = Omit<NameReadingDetails, 'strokes'>

export type NameResult =
  | {
      supported: false
      strokeConvention: null
      strokes: []
      gyeok: null
      numerology81: null
      yinYang: null
      fiveElements: null
      alternate: null
      axes: null
      limitations: NameLimitation[]
    }
  | {
      supported: true
      strokeConvention: StrokeConvention
      strokes: number[]
      gyeok: Gyeok
      numerology81: GyeokSuri
      yinYang: YinYangResult
      fiveElements: FiveElementsResult
      alternate: AlternateNameReading | null
      axes: null
      limitations: []
    }
