/**
 * Minimal ambient types for lunar-javascript (no official .d.ts shipped).
 * Only the methods used by the resident today page are declared.
 */
declare module 'lunar-javascript' {
  interface LunarDate {
    getYear(): number
    getMonth(): number
    getDay(): number
    getYearInGanZhi(): string
    getYearShengXiao(): string
    getMonthInChinese(): string
    getDayInChinese(): string
  }

  interface SolarDate {
    getLunar(): LunarDate
  }

  namespace Solar {
    function fromDate(date: Date): SolarDate
  }

  export { Solar }
}
