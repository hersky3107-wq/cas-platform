/**
 * Gradeable housing-price indexes. Codes are official series ids.
 * Korean 시군구 codes are 법정동. Unlisted districts are not invented.
 * 읍면동 and named complexes are not in this list.
 */

export type PropertyCountry = 'KR' | 'US' | 'UK' | 'JP' | 'AU'
export type PropertyCadence = 'month' | 'quarter'
export type PropertyTier = 'official' | 'fhfa' | 'zillow'
export type PropertyPubRule = 'kr15' | 'lastTue' | 'secondWed' | 'day15' | 'zillow16'

export type PropertyRegion = {
  country: PropertyCountry
  code: string
  nameKo: string
  nameEn: string
  aliases: readonly string[]
  chip: boolean
  cadence: PropertyCadence
  /** Months after the reference period until the scheduled release. */
  lagMonths: number
  pubRule: PropertyPubRule
  publisherKo: string
  seriesKo: string
  seriesEn: string
  tier: PropertyTier
  /** Default change metric before a percent threshold is attached. */
  metric: 'apt_sale_mom' | 'hpi_mom' | 'hpi_qoq'
}

function region(row: Omit<PropertyRegion, 'chip'> & { chip?: boolean }): PropertyRegion {
  return { chip: false, ...row }
}

const UK_HPI = {
  cadence: 'month' as const,
  lagMonths: 2,
  pubRule: 'secondWed' as const,
  publisherKo: 'UK HPI',
  seriesKo: '주택가격지수',
  seriesEn: 'UK House Price Index',
  tier: 'official' as const,
  metric: 'hpi_mom' as const,
}

const JP_HPI = {
  cadence: 'month' as const,
  lagMonths: 3,
  pubRule: 'day15' as const,
  publisherKo: '국토교통성',
  seriesKo: '주택 부동산가격지수',
  seriesEn: 'residential property price index',
  tier: 'official' as const,
  metric: 'hpi_mom' as const,
}

const AU_RPPI = {
  cadence: 'quarter' as const,
  lagMonths: 2,
  pubRule: 'day15' as const,
  publisherKo: 'ABS',
  seriesKo: '주거용 부동산가격지수',
  seriesEn: 'residential property price index',
  tier: 'official' as const,
  metric: 'hpi_qoq' as const,
}

const KR_SALE = {
  cadence: 'month' as const,
  lagMonths: 1,
  pubRule: 'kr15' as const,
  publisherKo: '부동산원',
  seriesKo: '아파트 매매가격지수',
  seriesEn: 'apartment sale-price index',
  tier: 'official' as const,
  metric: 'apt_sale_mom' as const,
}

export const PROPERTY_REGIONS: readonly PropertyRegion[] = [
  region({ country: 'KR', code: 'NAT', nameKo: '전국', nameEn: 'Korea', aliases: ['전국', '한국', '대한민국'], chip: true, ...KR_SALE }),
  region({ country: 'KR', code: '11', nameKo: '서울', nameEn: 'Seoul', aliases: ['서울', '서울특별시'], chip: true, ...KR_SALE }),
  region({ country: 'KR', code: '26', nameKo: '부산', nameEn: 'Busan', aliases: ['부산', '부산광역시'], ...KR_SALE }),
  region({ country: 'KR', code: '27', nameKo: '대구', nameEn: 'Daegu', aliases: ['대구', '대구광역시'], ...KR_SALE }),
  region({ country: 'KR', code: '28', nameKo: '인천', nameEn: 'Incheon', aliases: ['인천', '인천광역시'], ...KR_SALE }),
  region({ country: 'KR', code: '29', nameKo: '광주', nameEn: 'Gwangju', aliases: ['광주', '광주광역시'], ...KR_SALE }),
  region({ country: 'KR', code: '30', nameKo: '대전', nameEn: 'Daejeon', aliases: ['대전', '대전광역시'], ...KR_SALE }),
  region({ country: 'KR', code: '31', nameKo: '울산', nameEn: 'Ulsan', aliases: ['울산', '울산광역시'], ...KR_SALE }),
  region({ country: 'KR', code: '36', nameKo: '세종', nameEn: 'Sejong', aliases: ['세종', '세종시'], ...KR_SALE }),
  region({ country: 'KR', code: '41', nameKo: '경기', nameEn: 'Gyeonggi', aliases: ['경기', '경기도'], ...KR_SALE }),
  region({ country: 'KR', code: '51', nameKo: '강원', nameEn: 'Gangwon', aliases: ['강원', '강원도'], ...KR_SALE }),
  region({ country: 'KR', code: '43', nameKo: '충북', nameEn: 'Chungbuk', aliases: ['충북', '충청북도'], ...KR_SALE }),
  region({ country: 'KR', code: '44', nameKo: '충남', nameEn: 'Chungnam', aliases: ['충남', '충청남도'], ...KR_SALE }),
  region({ country: 'KR', code: '52', nameKo: '전북', nameEn: 'Jeonbuk', aliases: ['전북', '전라북도'], ...KR_SALE }),
  region({ country: 'KR', code: '46', nameKo: '전남', nameEn: 'Jeonnam', aliases: ['전남', '전라남도'], ...KR_SALE }),
  region({ country: 'KR', code: '47', nameKo: '경북', nameEn: 'Gyeongbuk', aliases: ['경북', '경상북도'], ...KR_SALE }),
  region({ country: 'KR', code: '48', nameKo: '경남', nameEn: 'Gyeongnam', aliases: ['경남', '경상남도'], ...KR_SALE }),
  region({ country: 'KR', code: '50', nameKo: '제주', nameEn: 'Jeju', aliases: ['제주', '제주도'], ...KR_SALE }),

  region({ country: 'KR', code: '11110', nameKo: '종로구', nameEn: 'Jongno-gu', aliases: ['종로구', '종로'], ...KR_SALE }),
  region({ country: 'KR', code: '11140', nameKo: '중구', nameEn: 'Seoul Jung-gu', aliases: ['서울중구'], ...KR_SALE }),
  region({ country: 'KR', code: '11170', nameKo: '용산구', nameEn: 'Yongsan-gu', aliases: ['용산구', '용산'], ...KR_SALE }),
  region({ country: 'KR', code: '11200', nameKo: '성동구', nameEn: 'Seongdong-gu', aliases: ['성동구', '성동'], ...KR_SALE }),
  region({ country: 'KR', code: '11215', nameKo: '광진구', nameEn: 'Gwangjin-gu', aliases: ['광진구', '광진'], ...KR_SALE }),
  region({ country: 'KR', code: '11230', nameKo: '동대문구', nameEn: 'Dongdaemun-gu', aliases: ['동대문구', '동대문'], ...KR_SALE }),
  region({ country: 'KR', code: '11260', nameKo: '중랑구', nameEn: 'Jungnang-gu', aliases: ['중랑구', '중랑'], ...KR_SALE }),
  region({ country: 'KR', code: '11290', nameKo: '성북구', nameEn: 'Seongbuk-gu', aliases: ['성북구', '성북'], ...KR_SALE }),
  region({ country: 'KR', code: '11305', nameKo: '강북구', nameEn: 'Gangbuk-gu', aliases: ['강북구', '강북'], ...KR_SALE }),
  region({ country: 'KR', code: '11320', nameKo: '도봉구', nameEn: 'Dobong-gu', aliases: ['도봉구', '도봉'], ...KR_SALE }),
  region({ country: 'KR', code: '11350', nameKo: '노원구', nameEn: 'Nowon-gu', aliases: ['노원구', '노원'], ...KR_SALE }),
  region({ country: 'KR', code: '11380', nameKo: '은평구', nameEn: 'Eunpyeong-gu', aliases: ['은평구', '은평'], ...KR_SALE }),
  region({ country: 'KR', code: '11410', nameKo: '서대문구', nameEn: 'Seodaemun-gu', aliases: ['서대문구', '서대문'], ...KR_SALE }),
  region({ country: 'KR', code: '11440', nameKo: '마포구', nameEn: 'Mapo-gu', aliases: ['마포구', '마포'], ...KR_SALE }),
  region({ country: 'KR', code: '11470', nameKo: '양천구', nameEn: 'Yangcheon-gu', aliases: ['양천구', '양천', '목동'], ...KR_SALE }),
  region({ country: 'KR', code: '11500', nameKo: '강서구', nameEn: 'Gangseo-gu', aliases: ['강서구', '강서'], ...KR_SALE }),
  region({ country: 'KR', code: '11530', nameKo: '구로구', nameEn: 'Guro-gu', aliases: ['구로구', '구로'], ...KR_SALE }),
  region({ country: 'KR', code: '11545', nameKo: '금천구', nameEn: 'Geumcheon-gu', aliases: ['금천구', '금천'], ...KR_SALE }),
  region({ country: 'KR', code: '11560', nameKo: '영등포구', nameEn: 'Yeongdeungpo-gu', aliases: ['영등포구', '영등포'], ...KR_SALE }),
  region({ country: 'KR', code: '11590', nameKo: '동작구', nameEn: 'Dongjak-gu', aliases: ['동작구', '동작'], ...KR_SALE }),
  region({ country: 'KR', code: '11620', nameKo: '관악구', nameEn: 'Gwanak-gu', aliases: ['관악구', '관악'], ...KR_SALE }),
  region({ country: 'KR', code: '11650', nameKo: '서초구', nameEn: 'Seocho-gu', aliases: ['서초구', '서초'], ...KR_SALE }),
  region({ country: 'KR', code: '11680', nameKo: '강남구', nameEn: 'Gangnam-gu', aliases: ['강남구', '강남'], chip: true, ...KR_SALE }),
  region({ country: 'KR', code: '11710', nameKo: '송파구', nameEn: 'Songpa-gu', aliases: ['송파구', '송파', '잠실'], ...KR_SALE }),
  region({ country: 'KR', code: '11740', nameKo: '강동구', nameEn: 'Gangdong-gu', aliases: ['강동구', '강동'], ...KR_SALE }),

  region({ country: 'KR', code: '26350', nameKo: '해운대구', nameEn: 'Haeundae-gu', aliases: ['해운대구', '해운대'], ...KR_SALE }),
  region({ country: 'KR', code: '26410', nameKo: '금정구', nameEn: 'Geumjeong-gu', aliases: ['금정구'], ...KR_SALE }),
  region({ country: 'KR', code: '26500', nameKo: '수영구', nameEn: 'Suyeong-gu', aliases: ['수영구'], ...KR_SALE }),
  region({ country: 'KR', code: '26260', nameKo: '동래구', nameEn: 'Dongnae-gu', aliases: ['동래구', '동래'], ...KR_SALE }),
  region({ country: 'KR', code: '26230', nameKo: '부산진구', nameEn: 'Busanjin-gu', aliases: ['부산진구', '서면'], ...KR_SALE }),

  region({ country: 'KR', code: '28185', nameKo: '연수구', nameEn: 'Yeonsu-gu', aliases: ['연수구', '송도'], ...KR_SALE }),
  region({ country: 'KR', code: '28200', nameKo: '남동구', nameEn: 'Namdong-gu', aliases: ['남동구'], ...KR_SALE }),
  region({ country: 'KR', code: '28237', nameKo: '부평구', nameEn: 'Bupyeong-gu', aliases: ['부평구', '부평'], ...KR_SALE }),

  region({ country: 'KR', code: '41135', nameKo: '분당구', nameEn: 'Bundang-gu', aliases: ['분당구', '분당'], ...KR_SALE }),
  region({ country: 'KR', code: '41131', nameKo: '수정구', nameEn: 'Sujeong-gu', aliases: ['수정구'], ...KR_SALE }),
  region({ country: 'KR', code: '41133', nameKo: '중원구', nameEn: 'Jungwon-gu', aliases: ['중원구'], ...KR_SALE }),
  region({ country: 'KR', code: '41111', nameKo: '장안구', nameEn: 'Jangan-gu', aliases: ['장안구'], ...KR_SALE }),
  region({ country: 'KR', code: '41113', nameKo: '권선구', nameEn: 'Gwonseon-gu', aliases: ['권선구'], ...KR_SALE }),
  region({ country: 'KR', code: '41115', nameKo: '팔달구', nameEn: 'Paldal-gu', aliases: ['팔달구'], ...KR_SALE }),
  region({ country: 'KR', code: '41117', nameKo: '영통구', nameEn: 'Yeongtong-gu', aliases: ['영통구', '영통'], ...KR_SALE }),
  region({ country: 'KR', code: '41463', nameKo: '기흥구', nameEn: 'Giheung-gu', aliases: ['기흥구', '기흥'], ...KR_SALE }),
  region({ country: 'KR', code: '41465', nameKo: '수지구', nameEn: 'Suji-gu', aliases: ['수지구', '수지'], ...KR_SALE }),
  region({ country: 'KR', code: '41461', nameKo: '처인구', nameEn: 'Cheoin-gu', aliases: ['처인구'], ...KR_SALE }),
  region({ country: 'KR', code: '41285', nameKo: '일산동구', nameEn: 'Ilsandong-gu', aliases: ['일산동구', '일산'], ...KR_SALE }),
  region({ country: 'KR', code: '41287', nameKo: '일산서구', nameEn: 'Ilsanseo-gu', aliases: ['일산서구'], ...KR_SALE }),
  region({ country: 'KR', code: '41281', nameKo: '덕양구', nameEn: 'Deogyang-gu', aliases: ['덕양구'], ...KR_SALE }),
  region({ country: 'KR', code: '41150', nameKo: '의정부시', nameEn: 'Uijeongbu', aliases: ['의정부', '의정부시'], ...KR_SALE }),
  region({ country: 'KR', code: '41590', nameKo: '화성시', nameEn: 'Hwaseong', aliases: ['화성', '화성시'], ...KR_SALE }),

  region({
    country: 'US',
    code: 'CSUSHPINSA',
    nameKo: '미국',
    nameEn: 'United States',
    aliases: ['미국', '미국부동산', 'us', 'usa', 'america', 'national'],
    chip: true,
    cadence: 'month',
    lagMonths: 2,
    pubRule: 'lastTue',
    publisherKo: 'S&P Case-Shiller',
    seriesKo: '전국 주택가격지수',
    seriesEn: 'national home price index (NSA)',
    tier: 'official',
    metric: 'hpi_mom',
  }),
  ...caseShillerCities(),
  ...fhfaStates(),
  ...zillowNeighborhoods(),

  region({
    country: 'UK',
    code: 'K02000001',
    nameKo: '영국',
    nameEn: 'United Kingdom',
    aliases: ['영국', 'uk', 'unitedkingdom'],
    chip: true,
    ...UK_HPI,
  }),
  region({ country: 'UK', code: 'E92000001', nameKo: '잉글랜드', nameEn: 'England', aliases: ['잉글랜드', 'england'], ...UK_HPI }),
  region({ country: 'UK', code: 'W92000004', nameKo: '웨일스', nameEn: 'Wales', aliases: ['웨일스', 'wales'], ...UK_HPI }),
  region({ country: 'UK', code: 'S92000003', nameKo: '스코틀랜드', nameEn: 'Scotland', aliases: ['스코틀랜드', 'scotland'], ...UK_HPI }),
  region({ country: 'UK', code: 'N92000002', nameKo: '북아일랜드', nameEn: 'Northern Ireland', aliases: ['북아일랜드'], ...UK_HPI }),
  region({ country: 'UK', code: 'E12000007', nameKo: '런던', nameEn: 'London', aliases: ['런던', 'london'], chip: true, ...UK_HPI }),
  region({ country: 'UK', code: 'E12000008', nameKo: '사우스이스트', nameEn: 'South East', aliases: ['사우스이스트'], ...UK_HPI }),
  region({ country: 'UK', code: 'E09000033', nameKo: '웨스트민스터', nameEn: 'Westminster', aliases: ['웨스트민스터', 'westminster'], ...UK_HPI }),
  region({ country: 'UK', code: 'E09000007', nameKo: '캠든', nameEn: 'Camden', aliases: ['캠든', 'camden'], ...UK_HPI }),
  region({ country: 'UK', code: 'E09000020', nameKo: '켄싱턴', nameEn: 'Kensington and Chelsea', aliases: ['켄싱턴', 'kensington'], ...UK_HPI }),
  region({ country: 'UK', code: 'E09000028', nameKo: '사우스워크', nameEn: 'Southwark', aliases: ['사우스워크', 'southwark'], ...UK_HPI }),
  region({ country: 'UK', code: 'E09000030', nameKo: '타워햄릿', nameEn: 'Tower Hamlets', aliases: ['타워햄릿'], ...UK_HPI }),

  region({ country: 'JP', code: 'NAT', nameKo: '일본', nameEn: 'Japan', aliases: ['일본', 'japan'], chip: true, ...JP_HPI }),
  region({ country: 'JP', code: 'HOKKAIDO', nameKo: '홋카이도', nameEn: 'Hokkaido', aliases: ['홋카이도', 'hokkaido'], ...JP_HPI }),
  region({ country: 'JP', code: 'TOHOKU', nameKo: '도호쿠', nameEn: 'Tohoku', aliases: ['도호쿠', 'tohoku'], ...JP_HPI }),
  region({ country: 'JP', code: 'KANTO', nameKo: '간토', nameEn: 'Kanto', aliases: ['간토', 'kanto'], ...JP_HPI }),
  region({ country: 'JP', code: 'HOKURIKU', nameKo: '호쿠리쿠', nameEn: 'Hokuriku', aliases: ['호쿠리쿠'], ...JP_HPI }),
  region({ country: 'JP', code: 'CHUBU', nameKo: '주부', nameEn: 'Chubu', aliases: ['주부', 'chubu'], ...JP_HPI }),
  region({ country: 'JP', code: 'KINKI', nameKo: '긴키', nameEn: 'Kinki', aliases: ['긴키', 'kinki'], ...JP_HPI }),
  region({ country: 'JP', code: 'CHUGOKU', nameKo: '주고쿠', nameEn: 'Chugoku', aliases: ['주고쿠'], ...JP_HPI }),
  region({ country: 'JP', code: 'SHIKOKU', nameKo: '시코쿠', nameEn: 'Shikoku', aliases: ['시코쿠'], ...JP_HPI }),
  region({ country: 'JP', code: 'KYUSHU', nameKo: '규슈', nameEn: 'Kyushu', aliases: ['규슈', '오키나와', 'kyushu'], ...JP_HPI }),
  region({ country: 'JP', code: 'SOUTH_KANTO', nameKo: '남관동', nameEn: 'South Kanto', aliases: ['남관동'], ...JP_HPI }),
  region({ country: 'JP', code: 'NAGOYA', nameKo: '나고야권', nameEn: 'Nagoya', aliases: ['나고야', 'nagoya'], ...JP_HPI }),
  region({ country: 'JP', code: 'KEIHANSHIN', nameKo: '경한신', nameEn: 'Keihanshin', aliases: ['경한신', '오사카권'], ...JP_HPI }),
  region({ country: 'JP', code: '13', nameKo: '도쿄도', nameEn: 'Tokyo', aliases: ['도쿄', '도쿄도', 'tokyo'], chip: true, ...JP_HPI }),
  region({ country: 'JP', code: '23', nameKo: '아이치현', nameEn: 'Aichi', aliases: ['아이치', '아이치현', 'aichi'], ...JP_HPI }),
  region({ country: 'JP', code: '27', nameKo: '오사카부', nameEn: 'Osaka', aliases: ['오사카', '오사카부', 'osaka'], ...JP_HPI }),

  region({ country: 'AU', code: 'AUS', nameKo: '호주', nameEn: 'Australia', aliases: ['호주', 'australia', '호주부동산'], chip: true, ...AU_RPPI }),
  region({ country: 'AU', code: 'SYD', nameKo: '시드니', nameEn: 'Sydney', aliases: ['시드니', 'sydney'], chip: true, ...AU_RPPI }),
  region({ country: 'AU', code: 'MEL', nameKo: '멜버른', nameEn: 'Melbourne', aliases: ['멜버른', 'melbourne'], chip: true, ...AU_RPPI }),
  region({ country: 'AU', code: 'BRI', nameKo: '브리즈번', nameEn: 'Brisbane', aliases: ['브리즈번', 'brisbane'], ...AU_RPPI }),
  region({ country: 'AU', code: 'ADL', nameKo: '애들레이드', nameEn: 'Adelaide', aliases: ['애들레이드', 'adelaide'], ...AU_RPPI }),
  region({ country: 'AU', code: 'PER', nameKo: '퍼스', nameEn: 'Perth', aliases: ['퍼스', 'perth'], ...AU_RPPI }),
  region({ country: 'AU', code: 'HOB', nameKo: '호바트', nameEn: 'Hobart', aliases: ['호바트', 'hobart'], ...AU_RPPI }),
  region({ country: 'AU', code: 'DAR', nameKo: '다윈', nameEn: 'Darwin', aliases: ['다윈', 'darwin'], ...AU_RPPI }),
  region({ country: 'AU', code: 'CBR', nameKo: '캔버라', nameEn: 'Canberra', aliases: ['캔버라', 'canberra'], ...AU_RPPI }),
]

function caseShillerCities(): PropertyRegion[] {
  const CS_CITIES: ReadonlyArray<readonly [string, string, string, readonly string[]]> = [
    ['BOXRNSA', '보스턴', 'Boston', ['보스턴', 'boston']],
    ['CHXRNSA', '시카고', 'Chicago', ['시카고', 'chicago']],
    ['DNXRNSA', '덴버', 'Denver', ['덴버', 'denver']],
    ['LVXRNSA', '라스베이거스', 'Las Vegas', ['라스베이거스', 'lasvegas']],
    ['LXXRNSA', '로스앤젤레스', 'Los Angeles', ['로스앤젤레스', 'la', 'losangeles']],
    ['MIXRNSA', '마이애미', 'Miami', ['마이애미', 'miami']],
    ['NYXRNSA', '뉴욕', 'New York', ['뉴욕', 'newyork', 'nyc']],
    ['SDXRNSA', '샌디에이고', 'San Diego', ['샌디에이고', 'sandiego']],
    ['SFXRNSA', '샌프란시스코', 'San Francisco', ['샌프란시스코', 'sanfrancisco']],
    ['WDXRNSA', '워싱턴', 'Washington', ['워싱턴', 'washington', 'dc']],
    ['ATXRNSA', '애틀랜타', 'Atlanta', ['애틀랜타', 'atlanta']],
    ['CRXRNSA', '샬럿', 'Charlotte', ['샬럿', 'charlotte']],
    ['CEXRNSA', '클리블랜드', 'Cleveland', ['클리블랜드', 'cleveland']],
    ['DAXRNSA', '댈러스', 'Dallas', ['댈러스', 'dallas']],
    ['DEXRNSA', '디트로이트', 'Detroit', ['디트로이트', 'detroit']],
    ['MNXRNSA', '미니애폴리스', 'Minneapolis', ['미니애폴리스', 'minneapolis']],
    ['PHXRNSA', '피닉스', 'Phoenix', ['피닉스', 'phoenix']],
    ['POXRNSA', '포틀랜드', 'Portland', ['포틀랜드', 'portland']],
    ['SEXRNSA', '시애틀', 'Seattle', ['시애틀', 'seattle']],
    ['TPXRNSA', '탬파', 'Tampa', ['탬파', 'tampa']],
  ]
  return CS_CITIES.map(([code, nameKo, nameEn, aliases]) =>
    region({
      country: 'US',
      code,
      nameKo,
      nameEn,
      aliases,
      chip: code === 'NYXRNSA' || code === 'LXXRNSA',
      cadence: 'month',
      lagMonths: 2,
      pubRule: 'lastTue',
      publisherKo: 'S&P Case-Shiller',
      seriesKo: '주택가격지수',
      seriesEn: 'Case-Shiller home price index (NSA)',
      tier: 'official',
      metric: 'hpi_mom',
    }),
  )
}

function fhfaStates(): PropertyRegion[] {
  const FHFA_STATES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['CA', '캘리포니아', ['캘리포니아', 'california']],
    ['NY', '뉴욕주', ['뉴욕주']],
    ['TX', '텍사스', ['텍사스', 'texas']],
    ['FL', '플로리다', ['플로리다', 'florida']],
    ['WA', '워싱턴주', ['워싱턴주']],
    ['IL', '일리노이', ['일리노이', 'illinois']],
  ]
  return FHFA_STATES.map(([code, nameKo, aliases]) =>
    region({
      country: 'US',
      code: `FHFA_${code}`,
      nameKo,
      nameEn: nameKo,
      aliases,
      chip: false,
      cadence: 'quarter',
      lagMonths: 2,
      pubRule: 'day15',
      publisherKo: 'FHFA',
      seriesKo: '주택가격지수',
      seriesEn: 'FHFA purchase-only HPI',
      tier: 'fhfa',
      metric: 'hpi_qoq',
    }),
  )
}

function zillowNeighborhoods(): PropertyRegion[] {
  const rows: ReadonlyArray<readonly [string, string, string, readonly string[]]> = [
    ['ZZSOHO', '소호', 'SoHo', ['소호', 'soho']],
    ['ZZBK', '브루클린', 'Brooklyn', ['브루클린', 'brooklyn']],
  ]
  return rows.map(([code, nameKo, nameEn, aliases]) =>
    region({
      country: 'US',
      code,
      nameKo,
      nameEn,
      aliases,
      chip: false,
      cadence: 'month',
      lagMonths: 1,
      pubRule: 'zillow16',
      publisherKo: 'Zillow ZHVI',
      seriesKo: '주택가치지수',
      seriesEn: 'Zillow Home Value Index (unofficial)',
      tier: 'zillow',
      metric: 'hpi_mom',
    }),
  )
}

const BY_KEY = new Map(PROPERTY_REGIONS.map((row) => [`${row.country}:${row.code}`, row]))

export function propertyRegion(country: string, code: string): PropertyRegion | null {
  return BY_KEY.get(`${country}:${code}`) ?? null
}

export function chipPropertyRegions(): readonly PropertyRegion[] {
  return PROPERTY_REGIONS.filter((row) => row.chip)
}
