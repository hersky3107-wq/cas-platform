/**
 * JEJU TOURIST mode UI strings — use `getTouristUiPack(locale)` or the
 * `useTouristUi()` hook (components/jeju/useTouristUi.ts).
 *
 * Korean (KO) is the source of truth with REAL values. Other locales spread KO
 * as a fallback (`...KO`) and override only the strings that have been
 * translated so far. This lets us translate incrementally without ever showing
 * an empty string — untranslated keys safely render Korean.
 *
 * Steps 1–2 (this file): the full tourist-mode UI chrome is translated —
 *   - chips, section headings, search box
 *   - section notes, loading / error / retry messages
 *   - course form (course-panel), course timeline, detail modal, card labels
 * Only AI-generated content (sonar/compose results) remains Korean for now.
 */

export const TOURIST_LOCALES = ['ko', 'en', 'ja', 'zh-TW', 'zh-CN'] as const

export type TouristLocale = (typeof TOURIST_LOCALES)[number]

export type TouristUiPack = {
  // ── Page header ──
  pageTitle: string

  // ── Search box ──
  searchPlaceholder: string
  searchButton: string

  // ── Chip labels ──
  chipCourse: string
  chipLocal: string
  chipFestival: string
  chipSeasonal: string
  chipRainy: string
  chipIslands: string
  chipOlle: string
  chipOreum: string

  // ── Section headings (emoji kept inline to match current layout) ──
  headingRainy: string
  headingLocal: string
  headingFestivalSonar: string
  headingFestivalFallback: string
  headingSeasonal: string
  headingIslands: string
  headingOreum: string
  headingDullegil: string
  headingOlle: string

  // ── Section notes (long — KO stub for now) ──
  noteRainy: string
  noteLocal: string
  noteFestivalSonar: string
  noteFestivalFallback: string
  noteSeasonal: string
  noteIslands: string
  noteOreum: string
  noteDullegil: string
  noteOlle: string

  // ── Section notes ──

  // ── Loading / error / retry ──
  retryMessage: string
  retryButton: string
  errRecommend: string
  errFestival: string
  errSeasonal: string
  errIslands: string
  errOlle: string
  errOreum: string
  errConnection: string

  // ── Rotating loading messages (per chip mode) ──
  loadSearch: string[]
  loadLocal: string[]
  loadFestival: string[]
  loadSeasonal: string[]
  loadRainy: string[]
  loadIslands: string[]
  loadOlle: string[]
  loadOreum: string[]
  loadCourse: string[]

  // ── Card category labels ──
  catSpots: string
  catFood: string
  catShopping: string
  catFestival: string
  catTheme: string
  catOreum: string

  // ── Course form (course-panel) ──
  courseModeCustomTitle: string
  courseModeCustomSub: string
  courseModeStandardTitle: string
  courseModeStandardSub: string
  coursePlaceholder: string
  courseDuration: string
  durationHalf: string
  durationFull: string
  courseArea: string
  areaAny: string
  areaJejuCity: string
  areaSeogwipo: string
  areaEast: string
  areaWest: string
  courseCompanion: string
  compFamily: string
  compFriends: string
  compSolo: string
  compGroup: string
  courseAge: string
  age20: string
  age30: string
  age40: string
  age50plus: string
  ageMixed: string
  courseGroupSize: string
  groupSizePlaceholder: string
  groupSizeUnit: string
  courseSubmitCustom: string
  courseSubmitStandard: string
  courseSubmitLoading: string
  courseLoadingNote: string
  courseErrFail: string
  loadCourseCustom: string[]
  loadCourseStandard: string[]
  tabPopular: string
  tabHealing: string
  tabLocal: string
  tabActive: string

  // ── Course timeline ──
  timeMorning: string
  timeLunch: string
  timeAfternoon: string
  timeEvening: string
  timeDefault: string
  srcWeb: string
  srcOfficial: string
  srcWebTitle: string
  srcOfficialTitle: string
  courseDisclaimer: string

  // ── Detail modal ──
  modalClose: string
  mapSearchWeb: string
  mapViewDirections: string
  mapWebNote: string
  mapNoLocation: string
  mapVerifyNote: string
  mapNaver: string
  mapKakao: string

  // ── Bus (🚌) feature ──
  chipBus: string
  busHeading: string
  busTabNearby: string
  busTabRoute: string
  busUseLocation: string
  busLocating: string
  busLocationHelp: string
  busPresetLabel: string
  busSelectStationHint: string
  busNoStations: string
  busArrivalsTitle: string
  busNoArrivals: string
  busRefresh: string
  busBackToStations: string
  busMinPrefix: string
  busMinUnit: string
  busArrivingSoon: string
  busStopsUnit: string
  busLowFloor: string
  busDistanceUnit: string
  busRoutePlaceholder: string
  busRouteSearch: string
  busRouteStopsTitle: string
  busRouteNotFound: string
  busMapView: string
  busErr: string
  busLoadNearby: string
  busLoadArrivals: string
  busLoadRoute: string
  anchorAirport: string
  anchorJejuCity: string
  anchorJejuTerminal: string
  anchorDongmun: string
  anchorSeogwipoCity: string
  anchorWorldcup: string
  anchorHamdeok: string
  anchorAewol: string
  anchorSeongsan: string
  anchorJungmun: string

  // ── Featured (server page) ──
  featuredHeading: string
  featuredBadge: string
  emptyTitle: string
  emptySubtitle: string
  sourceAttribution: string
}

// ── Korean — source of truth (real values) ─────────────────────────────────────

const KO: TouristUiPack = {
  pageTitle: '제주 AI 여행 안내',

  searchPlaceholder: '제주에서 뭐 하고 싶으세요?',
  searchButton: '찾기',

  chipCourse: 'AI 여행 코스 짜기',
  chipLocal: '관광객은 잘 모르는',
  chipFestival: '이번 주 축제',
  chipSeasonal: '지금 제주 풍경',
  chipRainy: '비 와도 좋은 곳',
  chipIslands: '섬 여행',
  chipOlle: '올레길',
  chipOreum: '오름·한라산',

  headingRainy: '☔ 비 와도 좋은 곳',
  headingLocal: '👀 관광객은 잘 모르는 제주',
  headingFestivalSonar: '🎪 지금 제주 축제·공연',
  headingFestivalFallback: '🎪 제주 축제·공연·전시',
  headingSeasonal: '🌸 지금 제주 풍경',
  headingIslands: '⛴️ 배 타고 가는 제주 섬',
  headingOreum: '🌋 제주 오름',
  headingDullegil: '🏔 한라산 둘레길',
  headingOlle: '🥾 제주 올레길',

  noteRainy: '비짓제주 공식 정보 기반',
  noteLocal: '공식 자연·문화 명소 + 현지인 추천을 섞어 보여드려요 · 웹 정보는 방문 전 확인하세요',
  noteFestivalSonar: '공식 채널 기준 진행 중·예정 행사예요 · 날짜·장소는 방문 전 확인하세요',
  noteFestivalFallback: '비짓제주 공식 행사 목록이에요 · 정확한 일정은 방문 전 확인하세요',
  noteSeasonal: '🌐 웹에서 찾은 실시간 정보예요 · 현장 상황은 변동될 수 있어요',
  noteIslands: '🌐 웹에서 찾은 정보예요 · 시간표·요금은 자주 바뀌니 방문 전 운항사 확인 필수',
  noteOreum: '제주의 오름을 소개해요 · 출처: 제주특별자치도 공공데이터 · 탐방 전 현장 상황을 확인하세요',
  noteDullegil: '한라산 국립공원을 한 바퀴 도는 8개 코스예요 · 출처: 제주특별자치도 · 제주데이터허브 (2021 기준)',
  noteOlle: '사단법인 제주올레 공식 코스 정보예요 · 출처: 제주올레 + 공공데이터포털',

  retryMessage: '조금 더 오래 걸리고 있어요. 다시 시도할까요?',
  retryButton: '다시 시도',
  errRecommend: '추천을 불러오지 못했어요. 다시 시도해 주세요.',
  errFestival: '축제 정보를 불러오지 못했어요. 다시 시도해 주세요.',
  errSeasonal: '제주 풍경 정보를 불러오지 못했어요. 다시 시도해 주세요.',
  errIslands: '섬 여행 정보를 불러오지 못했어요. 다시 시도해 주세요.',
  errOlle: '올레길 정보를 불러오지 못했어요. 다시 시도해 주세요.',
  errOreum: '오름 정보를 불러오지 못했어요. 다시 시도해 주세요.',
  errConnection: '연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.',

  loadSearch: ['제주를 살펴보는 중 🔍', '좋은 곳을 찾고 있어요'],
  loadLocal: ['제주 구석구석 살펴보는 중 🌿', '좋은 곳을 고르는 중이에요', '거의 다 됐어요 ✨'],
  loadFestival: ['지금 열리는 행사를 찾고 있어요 🎪', '공식 채널을 확인하는 중이에요', '거의 다 됐어요 ✨'],
  loadSeasonal: ['지금 제주 풍경을 살펴보는 중 🌸', '이 시기에 특별한 곳을 고르는 중이에요', '거의 다 됐어요 ✨'],
  loadRainy: ['비 와도 좋은 곳을 찾고 있어요 ☔', '실내 명소를 골라보는 중이에요', '거의 다 됐어요 ✨'],
  loadIslands: ['제주 섬 정보를 모으는 중 🌊', '배편·섬 매력을 정리하는 중이에요', '거의 다 됐어요 ✨'],
  loadOlle: ['올레길 코스 불러오는 중 🥾'],
  loadOreum: ['오름·한라산 정보 불러오는 중 🏔'],
  loadCourse: ['제주 여행 코스를 짜는 중이에요 🗺', '명소를 조합하고 있어요', '최적 동선을 확인하는 중이에요', '거의 다 됐어요 ✨'],

  catSpots: '가볼 곳',
  catFood: '맛집',
  catShopping: '쇼핑',
  catFestival: '축제',
  catTheme: '테마',
  catOreum: '오름',

  courseModeCustomTitle: '맞춤 코스',
  courseModeCustomSub: '상황·취향 알려주면 딱 맞는 코스 2개',
  courseModeStandardTitle: '추천 코스',
  courseModeStandardSub: '✨알찬 · 🌿힐링 · 🧭로컬 · 🤿액티브',
  coursePlaceholder: '원하는 여행이나 고려할 점을 자유롭게 적어주세요 — 예: 어르신·휠체어 동반, 아이와 함께, 감성 사진 카페 위주, 미식 여행 등',
  courseDuration: '여행 길이',
  durationHalf: '반나절',
  durationFull: '하루',
  courseArea: '지역 (선택)',
  areaAny: '상관없음',
  areaJejuCity: '제주시',
  areaSeogwipo: '서귀포',
  areaEast: '동부',
  areaWest: '서부',
  courseCompanion: '동행 (선택)',
  compFamily: '가족',
  compFriends: '친구',
  compSolo: '혼자',
  compGroup: '단체',
  courseAge: '연령대 (선택)',
  age20: '20대',
  age30: '30대',
  age40: '40대',
  age50plus: '50대 이상',
  ageMixed: '혼합',
  courseGroupSize: '인원 (선택)',
  groupSizePlaceholder: '예: 4',
  groupSizeUnit: '명',
  courseSubmitCustom: '맞춤 코스 짜기',
  courseSubmitStandard: '추천 코스 짜기',
  courseSubmitLoading: '코스 짜는 중…',
  courseLoadingNote: '좋은 코스를 위해 15~25초 정도 걸려요',
  courseErrFail: '코스를 만들지 못했어요. 다시 시도해 주세요.',
  loadCourseCustom: [
    'AI가 상황을 꼼꼼히 분석하고 있어요…',
    '딱 맞는 장소들을 고르고 있어요…',
    '편안한 동선과 시간 흐름을 짜는 중이에요…',
    '거의 다 됐어요, 조금만 기다려 주세요…',
  ],
  loadCourseStandard: [
    'AI가 4가지 코스를 구상하고 있어요…',
    '공공데이터에서 멋진 장소를 고르고 있어요…',
    '하루의 동선과 시간 흐름을 짜는 중이에요…',
    '거의 다 됐어요, 조금만 기다려 주세요…',
  ],
  tabPopular: '알찬 인기',
  tabHealing: '느긋한 힐링',
  tabLocal: '로컬 탐방',
  tabActive: '액티브',

  timeMorning: '오전',
  timeLunch: '점심',
  timeAfternoon: '오후',
  timeEvening: '저녁',
  timeDefault: '일정',
  srcWeb: '🌐 웹 보완',
  srcOfficial: '📋 공식',
  srcWebTitle: '웹에서 보완한 정보',
  srcOfficialTitle: '비짓제주 공식 정보',
  courseDisclaimer: 'AI가 공공데이터·웹 정보로 구성한 추천 코스예요 · 운영시간·휴무는 방문 전 확인하세요',

  modalClose: '닫기',
  mapSearchWeb: '지도에서 검색해보기 (참고)',
  mapViewDirections: '지도에서 보기 · 길찾기',
  mapWebNote: '정확한 위치는 검색 결과를 확인하세요. 행사·캠페인은 특정 장소가 없을 수 있어요.',
  mapNoLocation: '이 항목은 특정 장소가 지정되지 않았어요 (여러 장소·기간 진행 또는 캠페인).',
  mapVerifyNote: '정확한 위치·운영정보는 지도/공식 채널에서 확인하세요.',
  mapNaver: '네이버',
  mapKakao: '카카오',

  chipBus: '버스 정보',
  busHeading: '🚌 제주 버스',
  busTabNearby: '내 주변 버스',
  busTabRoute: '버스 번호로 찾기',
  busUseLocation: '현재 위치로 정류장 찾기',
  busLocating: '현재 위치를 확인하는 중…',
  busLocationHelp: '위치를 사용할 수 없으면 아래 주요 지점을 선택하세요.',
  busPresetLabel: '또는 주요 지점에서 찾기',
  busSelectStationHint: '정류장을 선택하면 실시간 도착 정보를 보여드려요.',
  busNoStations: '주변에서 정류장을 찾지 못했어요.',
  busArrivalsTitle: '실시간 도착 정보',
  busNoArrivals: '곧 도착하는 버스가 없어요. (운행 시간이 아닐 수 있어요)',
  busRefresh: '새로고침',
  busBackToStations: '정류장 목록으로',
  busMinPrefix: '약 ',
  busMinUnit: '분 후',
  busArrivingSoon: '곧 도착',
  busStopsUnit: '정거장 전',
  busLowFloor: '저상버스',
  busDistanceUnit: 'm',
  busRoutePlaceholder: '버스 번호 입력 (예: 600)',
  busRouteSearch: '찾기',
  busRouteStopsTitle: '이 버스가 가는 정류장',
  busRouteNotFound: '해당 번호의 버스를 찾지 못했어요. 번호를 확인해 주세요.',
  busMapView: '지도',
  busErr: '버스 정보를 불러오지 못했어요. 다시 시도해 주세요.',
  busLoadNearby: '주변 정류장을 찾고 있어요 🚌',
  busLoadArrivals: '도착 정보를 확인하는 중이에요',
  busLoadRoute: '버스 노선을 확인하는 중이에요',
  anchorAirport: '제주공항',
  anchorJejuCity: '제주시청',
  anchorJejuTerminal: '제주버스터미널',
  anchorDongmun: '동문시장',
  anchorSeogwipoCity: '서귀포시청',
  anchorWorldcup: '제주월드컵경기장',
  anchorHamdeok: '함덕해수욕장',
  anchorAewol: '애월',
  anchorSeongsan: '성산일출봉 입구',
  anchorJungmun: '중문관광단지',

  featuredHeading: '지금 뜨는 제주',
  featuredBadge: '실시간 비짓제주',
  emptyTitle: '지금 제주 정보를 불러오지 못했어요.',
  emptySubtitle: '잠시 후 다시 시도해 주세요.',
  sourceAttribution: '정보·이미지 출처: 비짓제주(제주관광공사)',
}

// ── English — KO fallback + high-value overrides ───────────────────────────────

const EN: TouristUiPack = {
  ...KO,
  pageTitle: 'Jeju AI Travel Guide',

  searchPlaceholder: 'What do you want to do in Jeju?',
  searchButton: 'Search',

  chipCourse: 'AI Trip Planner',
  chipLocal: 'Hidden Local Spots',
  chipFestival: "This Week's Festivals",
  chipSeasonal: 'Jeju Right Now',
  chipRainy: 'Great Even in Rain',
  chipIslands: 'Island Trips',
  chipOlle: 'Olle Trails',
  chipOreum: 'Oreum & Hallasan',

  headingRainy: '☔ Great Even in the Rain',
  headingLocal: '👀 Jeju Only Locals Know',
  headingFestivalSonar: '🎪 Jeju Festivals & Shows Now',
  headingFestivalFallback: '🎪 Jeju Festivals · Shows · Exhibits',
  headingSeasonal: '🌸 Jeju Scenery Right Now',
  headingIslands: '⛴️ Jeju Islands by Ferry',
  headingOreum: '🌋 Jeju Oreum',
  headingDullegil: '🏔 Hallasan Dullegil',
  headingOlle: '🥾 Jeju Olle Trail',

  noteRainy: 'Based on official VisitJeju info',
  noteLocal: 'A mix of official nature/culture spots + local picks · verify web info before visiting',
  noteFestivalSonar: 'Ongoing & upcoming events from official channels · check dates/venues before you go',
  noteFestivalFallback: 'Official VisitJeju event listings · confirm exact schedules before visiting',
  noteSeasonal: '🌐 Real-time info from the web · on-site conditions may vary',
  noteIslands: '🌐 Info from the web · schedules & fares change often, confirm with the operator before visiting',
  noteOreum: "Jeju's oreum (volcanic cones) · Source: Jeju Special Self-Governing Province open data · check on-site conditions before hiking",
  noteDullegil: '8 courses circling Hallasan National Park · Source: Jeju Province · Jeju Data Hub (as of 2021)',
  noteOlle: 'Official Jeju Olle Foundation course info · Source: Jeju Olle + Public Data Portal',

  retryMessage: 'This is taking a little longer. Try again?',
  retryButton: 'Try again',
  errRecommend: "Couldn't load recommendations. Please try again.",
  errFestival: "Couldn't load festival info. Please try again.",
  errSeasonal: "Couldn't load Jeju scenery info. Please try again.",
  errIslands: "Couldn't load island info. Please try again.",
  errOlle: "Couldn't load Olle trail info. Please try again.",
  errOreum: "Couldn't load oreum info. Please try again.",
  errConnection: 'Connection seems unstable. Please try again shortly.',

  loadSearch: ['Exploring Jeju 🔍', 'Finding great spots'],
  loadLocal: ['Looking all around Jeju 🌿', 'Picking the best spots', 'Almost there ✨'],
  loadFestival: ['Finding events happening now 🎪', 'Checking official channels', 'Almost there ✨'],
  loadSeasonal: ['Looking at Jeju right now 🌸', 'Picking spots special this season', 'Almost there ✨'],
  loadRainy: ['Finding spots great even in rain ☔', 'Picking indoor places', 'Almost there ✨'],
  loadIslands: ['Gathering Jeju island info 🌊', 'Sorting ferries & island charms', 'Almost there ✨'],
  loadOlle: ['Loading Olle trail courses 🥾'],
  loadOreum: ['Loading Oreum & Hallasan info 🏔'],
  loadCourse: ['Planning your Jeju trip 🗺', 'Combining the spots', 'Checking the best route', 'Almost there ✨'],

  catSpots: 'Attraction',
  catFood: 'Food',
  catShopping: 'Shopping',
  catFestival: 'Festival',
  catTheme: 'Theme',
  catOreum: 'Oreum',

  courseModeCustomTitle: 'Tailored Course',
  courseModeCustomSub: 'Tell us your situation — get 2 perfect courses',
  courseModeStandardTitle: 'Recommended',
  courseModeStandardSub: '✨Popular · 🌿Healing · 🧭Local · 🤿Active',
  coursePlaceholder: 'Freely describe your trip or things to consider — e.g. with elderly/wheelchair, traveling with kids, photo cafes, foodie trip, etc.',
  courseDuration: 'Trip length',
  durationHalf: 'Half day',
  durationFull: 'Full day',
  courseArea: 'Area (optional)',
  areaAny: 'Any',
  areaJejuCity: 'Jeju City',
  areaSeogwipo: 'Seogwipo',
  areaEast: 'East',
  areaWest: 'West',
  courseCompanion: 'Companions (optional)',
  compFamily: 'Family',
  compFriends: 'Friends',
  compSolo: 'Solo',
  compGroup: 'Group',
  courseAge: 'Age group (optional)',
  age20: '20s',
  age30: '30s',
  age40: '40s',
  age50plus: '50s+',
  ageMixed: 'Mixed',
  courseGroupSize: 'Group size (optional)',
  groupSizePlaceholder: 'e.g. 4',
  groupSizeUnit: 'people',
  courseSubmitCustom: 'Plan Tailored Course',
  courseSubmitStandard: 'Plan Recommended Course',
  courseSubmitLoading: 'Planning…',
  courseLoadingNote: 'A good course takes about 15–25 seconds',
  courseErrFail: "Couldn't create a course. Please try again.",
  loadCourseCustom: [
    'AI is carefully analyzing your situation…',
    'Picking spots that fit just right…',
    'Arranging a comfortable route and timing…',
    'Almost done, just a moment…',
  ],
  loadCourseStandard: [
    'AI is designing 4 courses…',
    'Picking great spots from open data…',
    "Arranging the day's route and timing…",
    'Almost done, just a moment…',
  ],
  tabPopular: 'Popular',
  tabHealing: 'Healing',
  tabLocal: 'Local',
  tabActive: 'Active',

  timeMorning: 'Morning',
  timeLunch: 'Lunch',
  timeAfternoon: 'Afternoon',
  timeEvening: 'Evening',
  timeDefault: 'Schedule',
  srcWeb: '🌐 Web',
  srcOfficial: '📋 Official',
  srcWebTitle: 'Supplemented from the web',
  srcOfficialTitle: 'Official VisitJeju info',
  courseDisclaimer: 'A course AI built from open data & web info · confirm hours/closures before visiting',

  modalClose: 'Close',
  mapSearchWeb: 'Search on map (reference)',
  mapViewDirections: 'View on map · Directions',
  mapWebNote: 'Check the search results for the exact location. Events/campaigns may not have a fixed place.',
  mapNoLocation: 'This item has no specific location (multiple places/dates or a campaign).',
  mapVerifyNote: 'Confirm exact location & hours on the map / official channels.',
  mapNaver: 'Naver',
  mapKakao: 'Kakao',

  chipBus: 'Bus Info',
  busHeading: '🚌 Jeju Bus',
  busTabNearby: 'Buses Near Me',
  busTabRoute: 'Find by Bus Number',
  busUseLocation: 'Find stops near my location',
  busLocating: 'Getting your location…',
  busLocationHelp: "If location isn't available, pick a key spot below.",
  busPresetLabel: 'Or find from a key spot',
  busSelectStationHint: 'Pick a stop to see real-time arrivals.',
  busNoStations: "Couldn't find any stops nearby.",
  busArrivalsTitle: 'Real-time arrivals',
  busNoArrivals: 'No buses arriving soon. (May be outside service hours)',
  busRefresh: 'Refresh',
  busBackToStations: 'Back to stops',
  busMinPrefix: '~',
  busMinUnit: ' min',
  busArrivingSoon: 'Arriving soon',
  busStopsUnit: ' stops away',
  busLowFloor: 'Low-floor',
  busDistanceUnit: 'm',
  busRoutePlaceholder: 'Enter bus number (e.g. 600)',
  busRouteSearch: 'Search',
  busRouteStopsTitle: 'Stops on this route',
  busRouteNotFound: "Couldn't find that bus number. Please check it.",
  busMapView: 'Map',
  busErr: "Couldn't load bus info. Please try again.",
  busLoadNearby: 'Finding stops near you 🚌',
  busLoadArrivals: 'Checking arrivals',
  busLoadRoute: 'Checking the bus route',
  anchorAirport: 'Jeju Airport',
  anchorJejuCity: 'Jeju City Hall',
  anchorJejuTerminal: 'Jeju Bus Terminal',
  anchorDongmun: 'Dongmun Market',
  anchorSeogwipoCity: 'Seogwipo City Hall',
  anchorWorldcup: 'Jeju World Cup Stadium',
  anchorHamdeok: 'Hamdeok Beach',
  anchorAewol: 'Aewol',
  anchorSeongsan: 'Seongsan Ilchulbong',
  anchorJungmun: 'Jungmun Resort',

  featuredHeading: 'Trending in Jeju',
  featuredBadge: 'Live · VisitJeju',
  emptyTitle: "Couldn't load Jeju info right now.",
  emptySubtitle: 'Please try again shortly.',
  sourceAttribution: 'Info & images: VisitJeju (Jeju Tourism Organization)',
}

// ── Japanese — KO fallback + high-value overrides ──────────────────────────────

const JA: TouristUiPack = {
  ...KO,
  pageTitle: '済州 AI 旅行ガイド',

  searchPlaceholder: '済州で何をしたいですか？',
  searchButton: '検索',

  chipCourse: 'AI旅行コース',
  chipLocal: '地元の人だけが知る',
  chipFestival: '今週のお祭り',
  chipSeasonal: '今の済州の風景',
  chipRainy: '雨でも楽しめる',
  chipIslands: '島めぐり',
  chipOlle: 'オルレギル',
  chipOreum: 'オルム・漢拏山',

  headingRainy: '☔ 雨でも楽しめる場所',
  headingLocal: '👀 地元の人が知る済州',
  headingFestivalSonar: '🎪 今の済州フェス・公演',
  headingFestivalFallback: '🎪 済州フェス・公演・展示',
  headingSeasonal: '🌸 今の済州の風景',
  headingIslands: '⛴️ 船で行く済州の島',
  headingOreum: '🌋 済州のオルム',
  headingDullegil: '🏔 漢拏山ドゥルレギル',
  headingOlle: '🥾 済州オルレギル',

  noteRainy: 'VisitJeju公式情報に基づく',
  noteLocal: '公式の自然・文化スポット＋地元のおすすめをミックス · ウェブ情報は訪問前にご確認ください',
  noteFestivalSonar: '公式チャンネル基準の開催中・開催予定イベントです · 日程・会場は訪問前にご確認ください',
  noteFestivalFallback: 'VisitJeju公式イベント一覧です · 正確な日程は訪問前にご確認ください',
  noteSeasonal: '🌐 ウェブで見つけたリアルタイム情報です · 現地の状況は変わることがあります',
  noteIslands: '🌐 ウェブで見つけた情報です · 時刻表・料金は変動が多いため、訪問前に運航会社の確認を',
  noteOreum: '済州のオルム（火山丘）を紹介 · 出典：済州特別自治道オープンデータ · 散策前に現地状況をご確認ください',
  noteDullegil: '漢拏山国立公園を一周する8コースです · 出典：済州道・済州データハブ（2021年時点）',
  noteOlle: '社団法人済州オルレ公式コース情報です · 出典：済州オルレ＋公共データポータル',

  retryMessage: '少し時間がかかっています。もう一度試しますか？',
  retryButton: '再試行',
  errRecommend: 'おすすめを読み込めませんでした。もう一度お試しください。',
  errFestival: 'お祭り情報を読み込めませんでした。もう一度お試しください。',
  errSeasonal: '済州の風景情報を読み込めませんでした。もう一度お試しください。',
  errIslands: '島の情報を読み込めませんでした。もう一度お試しください。',
  errOlle: 'オルレギル情報を読み込めませんでした。もう一度お試しください。',
  errOreum: 'オルム情報を読み込めませんでした。もう一度お試しください。',
  errConnection: '接続が不安定です。しばらくしてからもう一度お試しください。',

  loadSearch: ['済州を探しています 🔍', '良い場所を探しています'],
  loadLocal: ['済州のすみずみを探索中 🌿', '良い場所を選んでいます', 'もうすぐです ✨'],
  loadFestival: ['今開催中のイベントを探しています 🎪', '公式チャンネルを確認中', 'もうすぐです ✨'],
  loadSeasonal: ['今の済州の風景を探索中 🌸', 'この時期に特別な場所を選んでいます', 'もうすぐです ✨'],
  loadRainy: ['雨でも楽しめる場所を探しています ☔', '屋内スポットを選んでいます', 'もうすぐです ✨'],
  loadIslands: ['済州の島情報を集めています 🌊', '船便・島の魅力を整理中', 'もうすぐです ✨'],
  loadOlle: ['オルレギルのコースを読み込み中 🥾'],
  loadOreum: ['オルム・漢拏山情報を読み込み中 🏔'],
  loadCourse: ['済州旅行コースを作成中 🗺', 'スポットを組み合わせています', '最適なルートを確認中', 'もうすぐです ✨'],

  catSpots: '観光',
  catFood: 'グルメ',
  catShopping: 'ショッピング',
  catFestival: 'お祭り',
  catTheme: 'テーマ',
  catOreum: 'オルム',

  courseModeCustomTitle: 'カスタムコース',
  courseModeCustomSub: '状況・好みを教えると、ぴったりのコース2つ',
  courseModeStandardTitle: 'おすすめ',
  courseModeStandardSub: '✨人気 · 🌿癒し · 🧭ローカル · 🤿アクティブ',
  coursePlaceholder: 'ご希望の旅行や配慮したい点を自由にお書きください — 例：高齢者・車椅子同伴、子連れ、写真映えカフェ中心、グルメ旅など',
  courseDuration: '旅行の長さ',
  durationHalf: '半日',
  durationFull: '1日',
  courseArea: 'エリア（任意）',
  areaAny: '指定なし',
  areaJejuCity: '済州市',
  areaSeogwipo: '西帰浦',
  areaEast: '東部',
  areaWest: '西部',
  courseCompanion: '同行者（任意）',
  compFamily: '家族',
  compFriends: '友人',
  compSolo: '一人',
  compGroup: 'グループ',
  courseAge: '年齢層（任意）',
  age20: '20代',
  age30: '30代',
  age40: '40代',
  age50plus: '50代以上',
  ageMixed: '混合',
  courseGroupSize: '人数（任意）',
  groupSizePlaceholder: '例：4',
  groupSizeUnit: '名',
  courseSubmitCustom: 'カスタムコースを作成',
  courseSubmitStandard: 'おすすめコースを作成',
  courseSubmitLoading: '作成中…',
  courseLoadingNote: '良いコースのため15〜25秒ほどかかります',
  courseErrFail: 'コースを作成できませんでした。もう一度お試しください。',
  loadCourseCustom: [
    'AIが状況を丁寧に分析しています…',
    'ぴったりの場所を選んでいます…',
    '快適なルートと時間の流れを組んでいます…',
    'もうすぐです、少々お待ちください…',
  ],
  loadCourseStandard: [
    'AIが4つのコースを構想しています…',
    'オープンデータから素敵な場所を選んでいます…',
    '1日のルートと時間の流れを組んでいます…',
    'もうすぐです、少々お待ちください…',
  ],
  tabPopular: '人気',
  tabHealing: '癒し',
  tabLocal: 'ローカル',
  tabActive: 'アクティブ',

  timeMorning: '午前',
  timeLunch: '昼食',
  timeAfternoon: '午後',
  timeEvening: '夜',
  timeDefault: '予定',
  srcWeb: '🌐 ウェブ補完',
  srcOfficial: '📋 公式',
  srcWebTitle: 'ウェブで補完した情報',
  srcOfficialTitle: 'VisitJeju公式情報',
  courseDisclaimer: 'AIが公共データ・ウェブ情報で構成したおすすめコースです · 営業時間・休業は訪問前にご確認ください',

  modalClose: '閉じる',
  mapSearchWeb: '地図で検索（参考）',
  mapViewDirections: '地図で見る · 経路',
  mapWebNote: '正確な位置は検索結果でご確認ください。イベント・キャンペーンは特定の場所がない場合があります。',
  mapNoLocation: 'この項目は特定の場所が指定されていません（複数の場所・期間開催またはキャンペーン）。',
  mapVerifyNote: '正確な位置・営業情報は地図／公式チャンネルでご確認ください。',
  mapNaver: 'NAVER',
  mapKakao: 'カカオ',

  chipBus: 'バス情報',
  busHeading: '🚌 済州バス',
  busTabNearby: '周辺のバス',
  busTabRoute: 'バス番号で探す',
  busUseLocation: '現在地から停留所を探す',
  busLocating: '現在地を確認中…',
  busLocationHelp: '位置情報が使えない場合は、下の主要スポットを選んでください。',
  busPresetLabel: 'または主要スポットから探す',
  busSelectStationHint: '停留所を選ぶと、リアルタイムの到着情報を表示します。',
  busNoStations: '周辺に停留所が見つかりませんでした。',
  busArrivalsTitle: 'リアルタイム到着情報',
  busNoArrivals: 'まもなく到着するバスはありません。（運行時間外の可能性があります）',
  busRefresh: '更新',
  busBackToStations: '停留所一覧へ',
  busMinPrefix: '約',
  busMinUnit: '分後',
  busArrivingSoon: 'まもなく到着',
  busStopsUnit: '停留所前',
  busLowFloor: 'ノンステップ',
  busDistanceUnit: 'm',
  busRoutePlaceholder: 'バス番号を入力（例：600）',
  busRouteSearch: '検索',
  busRouteStopsTitle: 'このバスが通る停留所',
  busRouteNotFound: 'その番号のバスが見つかりませんでした。番号をご確認ください。',
  busMapView: '地図',
  busErr: 'バス情報を読み込めませんでした。もう一度お試しください。',
  busLoadNearby: '周辺の停留所を探しています 🚌',
  busLoadArrivals: '到着情報を確認中',
  busLoadRoute: 'バス路線を確認中',
  anchorAirport: '済州空港',
  anchorJejuCity: '済州市庁',
  anchorJejuTerminal: '済州バスターミナル',
  anchorDongmun: '東門市場',
  anchorSeogwipoCity: '西帰浦市庁',
  anchorWorldcup: '済州ワールドカップスタジアム',
  anchorHamdeok: '咸徳海水浴場',
  anchorAewol: '涯月',
  anchorSeongsan: '城山日出峰 入口',
  anchorJungmun: '中文観光団地',

  featuredHeading: '今の済州の話題',
  featuredBadge: 'リアルタイム · VisitJeju',
  emptyTitle: '今、済州の情報を読み込めませんでした。',
  emptySubtitle: 'しばらくしてからもう一度お試しください。',
  sourceAttribution: '情報・画像出典：VisitJeju（済州観光公社）',
}

// ── Traditional Chinese — KO fallback + high-value overrides ───────────────────

const ZH_TW: TouristUiPack = {
  ...KO,
  pageTitle: '濟州 AI 旅遊指南',

  searchPlaceholder: '想在濟州做什麼？',
  searchButton: '搜尋',

  chipCourse: 'AI行程規劃',
  chipLocal: '在地人才知道',
  chipFestival: '本週慶典',
  chipSeasonal: '此刻濟州風景',
  chipRainy: '雨天也很棒',
  chipIslands: '跳島之旅',
  chipOlle: '偶來小路',
  chipOreum: '小火山·漢拏山',

  headingRainy: '☔ 雨天也很棒的地方',
  headingLocal: '👀 在地人才知道的濟州',
  headingFestivalSonar: '🎪 此刻濟州慶典·演出',
  headingFestivalFallback: '🎪 濟州慶典·演出·展覽',
  headingSeasonal: '🌸 此刻濟州風景',
  headingIslands: '⛴️ 搭船去濟州離島',
  headingOreum: '🌋 濟州小火山',
  headingDullegil: '🏔 漢拏山環山步道',
  headingOlle: '🥾 濟州偶來小路',

  noteRainy: '依據 VisitJeju 官方資訊',
  noteLocal: '混合官方自然・文化景點＋在地人推薦 · 網路資訊請於造訪前確認',
  noteFestivalSonar: '依官方管道整理的進行中・即將舉行活動 · 日期・地點請於造訪前確認',
  noteFestivalFallback: 'VisitJeju 官方活動清單 · 確切日程請於造訪前確認',
  noteSeasonal: '🌐 從網路找到的即時資訊 · 現場狀況可能有變',
  noteIslands: '🌐 從網路找到的資訊 · 班次・票價常變動，造訪前務必向船公司確認',
  noteOreum: '介紹濟州的小火山（oreum） · 來源：濟州特別自治道公開資料 · 健行前請確認現場狀況',
  noteDullegil: '環繞漢拏山國家公園一圈的 8 條路線 · 來源：濟州道・濟州資料中心（2021 年）',
  noteOlle: '社團法人濟州偶來官方路線資訊 · 來源：濟州偶來＋公共資料入口',

  retryMessage: '花的時間有點久。要再試一次嗎？',
  retryButton: '再試一次',
  errRecommend: '無法載入推薦，請再試一次。',
  errFestival: '無法載入慶典資訊，請再試一次。',
  errSeasonal: '無法載入濟州風景資訊，請再試一次。',
  errIslands: '無法載入離島資訊，請再試一次。',
  errOlle: '無法載入偶來小路資訊，請再試一次。',
  errOreum: '無法載入小火山資訊，請再試一次。',
  errConnection: '連線似乎不穩定，請稍後再試。',

  loadSearch: ['正在探索濟州 🔍', '尋找好地方中'],
  loadLocal: ['正在探索濟州各角落 🌿', '正在挑選好地方', '快好了 ✨'],
  loadFestival: ['正在尋找此刻舉行的活動 🎪', '確認官方管道中', '快好了 ✨'],
  loadSeasonal: ['正在查看此刻的濟州風景 🌸', '挑選此時節特別的地方', '快好了 ✨'],
  loadRainy: ['尋找雨天也很棒的地方 ☔', '挑選室內景點中', '快好了 ✨'],
  loadIslands: ['彙整濟州離島資訊 🌊', '整理船班・離島魅力中', '快好了 ✨'],
  loadOlle: ['載入偶來小路路線中 🥾'],
  loadOreum: ['載入小火山・漢拏山資訊中 🏔'],
  loadCourse: ['規劃濟州行程中 🗺', '組合各景點中', '確認最佳路線中', '快好了 ✨'],

  catSpots: '景點',
  catFood: '美食',
  catShopping: '購物',
  catFestival: '慶典',
  catTheme: '主題',
  catOreum: '小火山',

  courseModeCustomTitle: '客製行程',
  courseModeCustomSub: '告訴我們情況・喜好，給你 2 條最合適的行程',
  courseModeStandardTitle: '推薦行程',
  courseModeStandardSub: '✨人氣 · 🌿療癒 · 🧭在地 · 🤿活力',
  coursePlaceholder: '請自由描述想要的旅行或需考量的事項 — 例：陪同長輩・輪椅、親子同行、以拍照咖啡廳為主、美食之旅等',
  courseDuration: '行程長度',
  durationHalf: '半天',
  durationFull: '一天',
  courseArea: '地區（選填）',
  areaAny: '不限',
  areaJejuCity: '濟州市',
  areaSeogwipo: '西歸浦',
  areaEast: '東部',
  areaWest: '西部',
  courseCompanion: '同行者（選填）',
  compFamily: '家庭',
  compFriends: '朋友',
  compSolo: '獨自',
  compGroup: '團體',
  courseAge: '年齡層（選填）',
  age20: '20多歲',
  age30: '30多歲',
  age40: '40多歲',
  age50plus: '50歲以上',
  ageMixed: '混合',
  courseGroupSize: '人數（選填）',
  groupSizePlaceholder: '例：4',
  groupSizeUnit: '人',
  courseSubmitCustom: '規劃客製行程',
  courseSubmitStandard: '規劃推薦行程',
  courseSubmitLoading: '規劃中…',
  courseLoadingNote: '好行程約需 15～25 秒',
  courseErrFail: '無法產生行程，請再試一次。',
  loadCourseCustom: [
    'AI 正在仔細分析你的情況…',
    '正在挑選最合適的地點…',
    '正在安排舒適的路線與時間…',
    '快完成了，請稍候…',
  ],
  loadCourseStandard: [
    'AI 正在構思 4 條行程…',
    '從公開資料挑選好地方…',
    '安排一天的路線與時間…',
    '快完成了，請稍候…',
  ],
  tabPopular: '人氣',
  tabHealing: '療癒',
  tabLocal: '在地',
  tabActive: '活力',

  timeMorning: '上午',
  timeLunch: '午餐',
  timeAfternoon: '下午',
  timeEvening: '晚上',
  timeDefault: '行程',
  srcWeb: '🌐 網路補充',
  srcOfficial: '📋 官方',
  srcWebTitle: '從網路補充的資訊',
  srcOfficialTitle: 'VisitJeju 官方資訊',
  courseDisclaimer: '由 AI 以公開資料・網路資訊構成的推薦行程 · 營業時間・公休請於造訪前確認',

  modalClose: '關閉',
  mapSearchWeb: '在地圖搜尋（參考）',
  mapViewDirections: '在地圖查看 · 路線',
  mapWebNote: '確切位置請查看搜尋結果。活動・宣傳可能沒有固定地點。',
  mapNoLocation: '此項目未指定特定地點（多地點・期間舉行或宣傳活動）。',
  mapVerifyNote: '確切位置・營業資訊請於地圖／官方管道確認。',
  mapNaver: 'Naver',
  mapKakao: 'Kakao',

  chipBus: '公車資訊',
  busHeading: '🚌 濟州公車',
  busTabNearby: '附近的公車',
  busTabRoute: '用公車號碼查詢',
  busUseLocation: '用目前位置尋找站牌',
  busLocating: '正在取得目前位置…',
  busLocationHelp: '若無法使用定位，請選擇下方主要地點。',
  busPresetLabel: '或從主要地點尋找',
  busSelectStationHint: '選擇站牌即可查看即時到站資訊。',
  busNoStations: '附近找不到站牌。',
  busArrivalsTitle: '即時到站資訊',
  busNoArrivals: '近期沒有公車進站。（可能非營運時間）',
  busRefresh: '重新整理',
  busBackToStations: '回到站牌清單',
  busMinPrefix: '約',
  busMinUnit: '分鐘後',
  busArrivingSoon: '即將到站',
  busStopsUnit: '站前',
  busLowFloor: '低底盤',
  busDistanceUnit: '公尺',
  busRoutePlaceholder: '輸入公車號碼（例：600）',
  busRouteSearch: '查詢',
  busRouteStopsTitle: '這班公車行經的站牌',
  busRouteNotFound: '找不到該號碼的公車，請確認號碼。',
  busMapView: '地圖',
  busErr: '無法載入公車資訊，請再試一次。',
  busLoadNearby: '正在尋找附近站牌 🚌',
  busLoadArrivals: '確認到站資訊中',
  busLoadRoute: '確認公車路線中',
  anchorAirport: '濟州機場',
  anchorJejuCity: '濟州市廳',
  anchorJejuTerminal: '濟州公車總站',
  anchorDongmun: '東門市場',
  anchorSeogwipoCity: '西歸浦市廳',
  anchorWorldcup: '濟州世界盃體育場',
  anchorHamdeok: '咸德海水浴場',
  anchorAewol: '涯月',
  anchorSeongsan: '城山日出峰 入口',
  anchorJungmun: '中文觀光園區',

  featuredHeading: '濟州正夯',
  featuredBadge: '即時 · VisitJeju',
  emptyTitle: '目前無法載入濟州資訊。',
  emptySubtitle: '請稍後再試。',
  sourceAttribution: '資訊・圖片來源：VisitJeju（濟州觀光公社）',
}

// ── Simplified Chinese — KO fallback + high-value overrides ────────────────────

const ZH_CN: TouristUiPack = {
  ...KO,
  pageTitle: '济州 AI 旅游指南',

  searchPlaceholder: '想在济州做什么？',
  searchButton: '搜索',

  chipCourse: 'AI行程规划',
  chipLocal: '当地人才知道',
  chipFestival: '本周庆典',
  chipSeasonal: '此刻济州风景',
  chipRainy: '雨天也很棒',
  chipIslands: '跳岛之旅',
  chipOlle: '偶来小路',
  chipOreum: '小火山·汉拿山',

  headingRainy: '☔ 雨天也很棒的地方',
  headingLocal: '👀 当地人才知道的济州',
  headingFestivalSonar: '🎪 此刻济州庆典·演出',
  headingFestivalFallback: '🎪 济州庆典·演出·展览',
  headingSeasonal: '🌸 此刻济州风景',
  headingIslands: '⛴️ 坐船去济州离岛',
  headingOreum: '🌋 济州小火山',
  headingDullegil: '🏔 汉拿山环山步道',
  headingOlle: '🥾 济州偶来小路',

  noteRainy: '依据 VisitJeju 官方信息',
  noteLocal: '混合官方自然・文化景点＋当地人推荐 · 网络信息请于到访前确认',
  noteFestivalSonar: '依官方渠道整理的进行中・即将举行活动 · 日期・地点请于到访前确认',
  noteFestivalFallback: 'VisitJeju 官方活动清单 · 确切日程请于到访前确认',
  noteSeasonal: '🌐 从网络找到的实时信息 · 现场情况可能有变',
  noteIslands: '🌐 从网络找到的信息 · 班次・票价常变动，到访前务必向船公司确认',
  noteOreum: '介绍济州的小火山（oreum） · 来源：济州特别自治道公开数据 · 徒步前请确认现场情况',
  noteDullegil: '环绕汉拿山国家公园一圈的 8 条路线 · 来源：济州道・济州数据中心（2021 年）',
  noteOlle: '社团法人济州偶来官方路线信息 · 来源：济州偶来＋公共数据门户',

  retryMessage: '花的时间有点久。要再试一次吗？',
  retryButton: '再试一次',
  errRecommend: '无法加载推荐，请再试一次。',
  errFestival: '无法加载庆典信息，请再试一次。',
  errSeasonal: '无法加载济州风景信息，请再试一次。',
  errIslands: '无法加载离岛信息，请再试一次。',
  errOlle: '无法加载偶来小路信息，请再试一次。',
  errOreum: '无法加载小火山信息，请再试一次。',
  errConnection: '连接似乎不稳定，请稍后再试。',

  loadSearch: ['正在探索济州 🔍', '寻找好地方中'],
  loadLocal: ['正在探索济州各角落 🌿', '正在挑选好地方', '快好了 ✨'],
  loadFestival: ['正在寻找此刻举行的活动 🎪', '确认官方渠道中', '快好了 ✨'],
  loadSeasonal: ['正在查看此刻的济州风景 🌸', '挑选此时节特别的地方', '快好了 ✨'],
  loadRainy: ['寻找雨天也很棒的地方 ☔', '挑选室内景点中', '快好了 ✨'],
  loadIslands: ['汇整济州离岛信息 🌊', '整理船班・离岛魅力中', '快好了 ✨'],
  loadOlle: ['加载偶来小路路线中 🥾'],
  loadOreum: ['加载小火山・汉拿山信息中 🏔'],
  loadCourse: ['规划济州行程中 🗺', '组合各景点中', '确认最佳路线中', '快好了 ✨'],

  catSpots: '景点',
  catFood: '美食',
  catShopping: '购物',
  catFestival: '庆典',
  catTheme: '主题',
  catOreum: '小火山',

  courseModeCustomTitle: '定制行程',
  courseModeCustomSub: '告诉我们情况・喜好，给你 2 条最合适的行程',
  courseModeStandardTitle: '推荐行程',
  courseModeStandardSub: '✨人气 · 🌿疗愈 · 🧭当地 · 🤿活力',
  coursePlaceholder: '请自由描述想要的旅行或需考虑的事项 — 例：陪同长辈・轮椅、亲子同行、以拍照咖啡馆为主、美食之旅等',
  courseDuration: '行程长度',
  durationHalf: '半天',
  durationFull: '一天',
  courseArea: '地区（选填）',
  areaAny: '不限',
  areaJejuCity: '济州市',
  areaSeogwipo: '西归浦',
  areaEast: '东部',
  areaWest: '西部',
  courseCompanion: '同行者（选填）',
  compFamily: '家庭',
  compFriends: '朋友',
  compSolo: '独自',
  compGroup: '团体',
  courseAge: '年龄层（选填）',
  age20: '20多岁',
  age30: '30多岁',
  age40: '40多岁',
  age50plus: '50岁以上',
  ageMixed: '混合',
  courseGroupSize: '人数（选填）',
  groupSizePlaceholder: '例：4',
  groupSizeUnit: '人',
  courseSubmitCustom: '规划定制行程',
  courseSubmitStandard: '规划推荐行程',
  courseSubmitLoading: '规划中…',
  courseLoadingNote: '好行程约需 15～25 秒',
  courseErrFail: '无法生成行程，请再试一次。',
  loadCourseCustom: [
    'AI 正在仔细分析你的情况…',
    '正在挑选最合适的地点…',
    '正在安排舒适的路线与时间…',
    '快完成了，请稍候…',
  ],
  loadCourseStandard: [
    'AI 正在构思 4 条行程…',
    '从公开数据挑选好地方…',
    '安排一天的路线与时间…',
    '快完成了，请稍候…',
  ],
  tabPopular: '人气',
  tabHealing: '疗愈',
  tabLocal: '当地',
  tabActive: '活力',

  timeMorning: '上午',
  timeLunch: '午餐',
  timeAfternoon: '下午',
  timeEvening: '晚上',
  timeDefault: '行程',
  srcWeb: '🌐 网络补充',
  srcOfficial: '📋 官方',
  srcWebTitle: '从网络补充的信息',
  srcOfficialTitle: 'VisitJeju 官方信息',
  courseDisclaimer: '由 AI 以公开数据・网络信息构成的推荐行程 · 营业时间・公休请于到访前确认',

  modalClose: '关闭',
  mapSearchWeb: '在地图搜索（参考）',
  mapViewDirections: '在地图查看 · 路线',
  mapWebNote: '确切位置请查看搜索结果。活动・宣传可能没有固定地点。',
  mapNoLocation: '此项目未指定特定地点（多地点・期间举行或宣传活动）。',
  mapVerifyNote: '确切位置・营业信息请于地图／官方渠道确认。',
  mapNaver: 'Naver',
  mapKakao: 'Kakao',

  chipBus: '公交信息',
  busHeading: '🚌 济州公交',
  busTabNearby: '附近的公交',
  busTabRoute: '用公交号码查询',
  busUseLocation: '用当前位置查找站点',
  busLocating: '正在获取当前位置…',
  busLocationHelp: '若无法使用定位，请选择下方主要地点。',
  busPresetLabel: '或从主要地点查找',
  busSelectStationHint: '选择站点即可查看实时到站信息。',
  busNoStations: '附近找不到站点。',
  busArrivalsTitle: '实时到站信息',
  busNoArrivals: '近期没有公交进站。（可能非运营时间）',
  busRefresh: '刷新',
  busBackToStations: '返回站点列表',
  busMinPrefix: '约',
  busMinUnit: '分钟后',
  busArrivingSoon: '即将到站',
  busStopsUnit: '站前',
  busLowFloor: '低地板',
  busDistanceUnit: '米',
  busRoutePlaceholder: '输入公交号码（例：600）',
  busRouteSearch: '查询',
  busRouteStopsTitle: '这班公交经过的站点',
  busRouteNotFound: '找不到该号码的公交，请确认号码。',
  busMapView: '地图',
  busErr: '无法加载公交信息，请再试一次。',
  busLoadNearby: '正在查找附近站点 🚌',
  busLoadArrivals: '确认到站信息中',
  busLoadRoute: '确认公交路线中',
  anchorAirport: '济州机场',
  anchorJejuCity: '济州市厅',
  anchorJejuTerminal: '济州公交总站',
  anchorDongmun: '东门市场',
  anchorSeogwipoCity: '西归浦市厅',
  anchorWorldcup: '济州世界杯体育场',
  anchorHamdeok: '咸德海水浴场',
  anchorAewol: '涯月',
  anchorSeongsan: '城山日出峰 入口',
  anchorJungmun: '中文观光园区',

  featuredHeading: '济州正热',
  featuredBadge: '实时 · VisitJeju',
  emptyTitle: '目前无法加载济州信息。',
  emptySubtitle: '请稍后再试。',
  sourceAttribution: '信息・图片来源：VisitJeju（济州观光公社）',
}

export const TOURIST_UI: Record<TouristLocale, TouristUiPack> = {
  ko: KO,
  en: EN,
  ja: JA,
  'zh-TW': ZH_TW,
  'zh-CN': ZH_CN,
}

/** Language options for the 🌐 toggle. Autonyms — identical in every locale. */
export const TOURIST_LANG_OPTIONS: { code: TouristLocale; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
]

function isTouristLocale(value: string): value is TouristLocale {
  return (TOURIST_LOCALES as readonly string[]).includes(value)
}

/** Localized tourist label pack; falls back to Korean. */
export function getTouristUiPack(locale: TouristLocale): TouristUiPack {
  return TOURIST_UI[locale] ?? TOURIST_UI.ko
}

/** Normalize a browser / stored locale string to a supported tourist locale. */
export function normalizeTouristLocale(uiLocale: string | null | undefined): TouristLocale {
  if (!uiLocale) return 'ko'
  const raw = uiLocale.trim().toLowerCase()
  if (!raw) return 'ko'

  if (raw.startsWith('ko')) return 'ko'
  if (raw.startsWith('ja')) return 'ja'
  // Simplified Chinese must be detected BEFORE the generic zh→zh-TW fallback.
  if (raw.startsWith('zh-cn') || raw.startsWith('zh-sg') || raw.includes('hans')) return 'zh-CN'
  if (raw.startsWith('zh-tw') || raw.startsWith('zh-hk') || raw.includes('hant')) return 'zh-TW'
  if (raw.startsWith('zh')) return 'zh-TW'
  if (raw.startsWith('en')) return 'en'

  const base = raw.split('-')[0] ?? ''
  if (isTouristLocale(base)) return base

  return 'ko'
}
