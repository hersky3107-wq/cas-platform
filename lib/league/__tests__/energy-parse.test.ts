import { describe, expect, it } from 'vitest'
import { parseEiaHeaderDate, parseEiaWngsr, parseEiaWpsrTable1 } from '../energy-parse'
import { parseCftcManagedMoney } from '../metals-parse'

const WPSR_FIXTURE = [
  '"STUB_1","9/11/26","9/4/26","Difference","Percent Change","9/12/25","Difference","Percent Change"',
  '"Crude Oil","708.386","709.429","-1.043","-0.100","821.089","-112.703","-13.700"',
  '"Commercial (Excluding SPR)","423.429","424.069","-0.640","-0.200","415.361","8.068","1.900"',
  '"Strategic Petroleum Reserve (SPR)","284.957","285.360","-0.403","-0.100","405.728","-120.771","-29.800"',
  '"STUB_1","STUB_2","9/11/26","9/4/26","Difference","9/12/25","Difference","9/11/26","9/12/25","Percent Change","9/11/26","9/12/25","Percent Change"',
  '"Crude Oil Supply ","(1)     Domestic Production","13,944","13,947","-3","13,482","462","13,899","13,460","3.3","13,730","13,437","2.2"',
  '"Crude Oil Supply ","(2)        Alaska","463","457","6","405","58","448","413","8.4","425","418","1.7"',
  '"Crude Oil Supply ","(17)   Crude Oil Input to Refineries","17,330","17,586","-256","16,424","906","17,451","16,748","4.2","16,674","16,315","2.2"',
  '"Products Supplied ","(30)   Total","21,255","19,313","1,942","20,637","618","20,548","20,671","-0.6","20,593","20,308","1.4"',
  '"Net Imports of Crude and Petroleum Products ","(33)   Total","-3,740","-3,759","19","-3,797","57"',
].join('\n')

const WNGSR_FIXTURE = {
  release_name: 'Weekly Natural Gas Storage Report',
  current_week: '2026-09-11',
  series: [
    {
      series_id: 'png.nw2_epg0_swo_r31_bcf.w',
      name: 'east region',
      calculated: { '5yr-avg': 752, net_change: 10, 'pct-change_yrago': 1, 'pct-chg_5yr-avg': 2 },
      data: [['2026-09-11', 800]],
    },
    {
      series_id: 'png.nw2_epg0_swo_r48_bcf.w',
      name: 'total lower 48 states',
      calculated: {
        '5yr-avg': 3180,
        net_change: 44,
        'pct-change_yrago': -3.6,
        'pct-chg_5yr-avg': 3.7,
      },
      data: [
        ['2026-09-11', 3298],
        ['2026-09-04', 3254],
        ['2025-09-11', 3420],
      ],
    },
  ],
}

describe('EIA WPSR table1 parser', () => {
  it('reads commercial stocks, SPR, production, refinery runs, and products supplied', () => {
    expect(parseEiaWpsrTable1(WPSR_FIXTURE)).toEqual({
      weekEnding: '2026-09-11',
      commercialStocksMMbbl: 423.429,
      commercialWowChangeMMbbl: -0.64,
      sprMMbbl: 284.957,
      productionKbpd: 13944,
      refineryRunsKbpd: 17330,
      productSuppliedKbpd: 21255,
    })
  })

  it('returns null on garbage and does not guess', () => {
    expect(parseEiaWpsrTable1('not a table')).toBeNull()
  })

  it('parses M/D/YY header dates', () => {
    expect(parseEiaHeaderDate('9/11/26')).toBe('2026-09-11')
    expect(parseEiaHeaderDate('9/4/26')).toBe('2026-09-04')
  })
})

describe('EIA WNGSR parser', () => {
  it('reads Lower-48 working gas, net change, and vs 5yr / year-ago', () => {
    expect(parseEiaWngsr(WNGSR_FIXTURE)).toEqual({
      weekEnding: '2026-09-11',
      storageBcf: 3298,
      netChangeBcf: 44,
      vs5yrAvgPct: 3.7,
      vsYearAgoPct: -3.6,
      fiveYearAvgBcf: 3180,
    })
  })

  it('returns null when Lower-48 is missing', () => {
    expect(parseEiaWngsr({ series: [{ name: 'east region', data: [] }] })).toBeNull()
  })
})

describe('CFTC energy contract codes', () => {
  it('parses NYMEX WTI physical (067651)', () => {
    const line =
      '"WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE",260915,2026-09-15,067651,NYME,01,067,1955764,0,0,0,0,0,221896,115617'
    expect(parseCftcManagedMoney(line, '067651')).toEqual({
      contract: 'WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE',
      date: '2026-09-15',
      openInterest: 1955764,
      managedMoneyLong: 221896,
      managedMoneyShort: 115617,
      managedMoneyNet: 106279,
    })
  })

  it('parses NYMEX Henry Hub natgas (023651)', () => {
    const line =
      '"NAT GAS NYME - NEW YORK MERCANTILE EXCHANGE",260915,2026-09-15,023651,NYME,01,023,1820003,0,0,0,0,0,264362,364567'
    expect(parseCftcManagedMoney(line, '023651')).toMatchObject({
      openInterest: 1820003,
      managedMoneyLong: 264362,
      managedMoneyShort: 364567,
      managedMoneyNet: -100205,
    })
  })

  it('parses NYMEX Brent last day (06765T)', () => {
    const line =
      '"BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE",260915,2026-09-15,06765T,NYME,01,067,260719,0,0,0,0,0,9534,1638'
    expect(parseCftcManagedMoney(line, '06765T')).toMatchObject({
      managedMoneyLong: 9534,
      managedMoneyShort: 1638,
      managedMoneyNet: 7896,
    })
  })

  it('parses COMEX copper (085692), CBOT grains, and ICE coffee C', () => {
    expect(
      parseCftcManagedMoney(
        '"COPPER- #1 - COMMODITY EXCHANGE INC.",260915,2026-09-15,085692,CMX,01,085,289463,0,0,0,0,0,83704,18598',
        '085692',
      ),
    ).toMatchObject({ managedMoneyNet: 65106, openInterest: 289463 })
    expect(
      parseCftcManagedMoney(
        '"CORN - CHICAGO BOARD OF TRADE",260915,2026-09-15,002602,CBT,01,002,1843824,0,0,0,0,0,483738,69278',
        '002602',
      ),
    ).toMatchObject({ managedMoneyNet: 414460 })
    expect(
      parseCftcManagedMoney(
        '"WHEAT-SRW - CHICAGO BOARD OF TRADE",260915,2026-09-15,001602,CBT,01,001,485138,0,0,0,0,0,95798,99472',
        '001602',
      ),
    ).toMatchObject({ managedMoneyNet: -3674 })
    expect(
      parseCftcManagedMoney(
        '"SOYBEANS - CHICAGO BOARD OF TRADE",260915,2026-09-15,005602,CBT,01,005,1104880,0,0,0,0,0,282581,41080',
        '005602',
      ),
    ).toMatchObject({ managedMoneyNet: 241501 })
    expect(
      parseCftcManagedMoney(
        '"COFFEE C - ICE FUTURES U.S.",260915,2026-09-15,083731,NYBT,01,083,150458,0,0,0,0,0,35227,14566',
        '083731',
      ),
    ).toMatchObject({ managedMoneyNet: 20661 })
  })
})
