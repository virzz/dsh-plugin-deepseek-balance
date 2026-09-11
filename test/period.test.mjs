/**
 * Tariff-window tests. The helpers live inside the client module closure (the browser bundle
 * is a single concatenated file and cannot import a sibling), so this lifts the exact source
 * block out of lib/client.js and exercises it — the assertions run against the shipped code,
 * not a copy of it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

const start = source.indexOf('const BEIJING_SHIFT_MS')
const end = source.indexOf('/** A wallet glyph')
if (start === -1 || end === -1 || end <= start) {
  console.error('FAIL: could not locate the tariff block in lib/client.js')
  process.exit(1)
}
const { periodOf, minutesUntilSwitch, humanMinutes } = await import(
  `data:text/javascript,${encodeURIComponent(`${source.slice(start, end)}
export { periodOf, minutesUntilSwitch, humanMinutes }`)}`
)

/** One instant from a Beijing wall clock. Beijing is UTC+8, so subtract 8h from UTC. */
const beijing = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm)

/** Weekday of a UTC calendar date, used only to pick fixtures. */
const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()

// Fixtures are picked by weekday rather than hardcoded, so a wrong guess cannot silently
// turn every case into the same answer.
const YEAR = 2026
const MONTH = 9
let monday = 0
for (let day = 1; day <= 7; day += 1) {
  if (weekdayOf(YEAR, MONTH, day) === 1) monday = day
}
if (monday === 0) {
  console.error('FAIL: no Monday found in the fixture week')
  process.exit(1)
}
const friday = monday + 4
const saturday = monday + 5
const sunday = monday + 6

const cases = [
  ['Mon 08:59', beijing(YEAR, MONTH, monday, 8, 59), 'off'],
  ['Mon 09:00', beijing(YEAR, MONTH, monday, 9, 0), 'peak'],
  ['Mon 11:59', beijing(YEAR, MONTH, monday, 11, 59), 'peak'],
  ['Mon 12:00 (window closes)', beijing(YEAR, MONTH, monday, 12, 0), 'off'],
  ['Mon 13:59', beijing(YEAR, MONTH, monday, 13, 59), 'off'],
  ['Mon 14:00', beijing(YEAR, MONTH, monday, 14, 0), 'peak'],
  ['Mon 17:59', beijing(YEAR, MONTH, monday, 17, 59), 'peak'],
  ['Mon 18:00 (window closes)', beijing(YEAR, MONTH, monday, 18, 0), 'off'],
  ['Mon 23:59', beijing(YEAR, MONTH, monday, 23, 59), 'off'],
  ['Tue 00:00', beijing(YEAR, MONTH, monday + 1, 0, 0), 'off'],
  ['Fri 17:59', beijing(YEAR, MONTH, friday, 17, 59), 'peak'],
  ['Fri 18:00', beijing(YEAR, MONTH, friday, 18, 0), 'off'],
  ['Sat 10:00 (weekend)', beijing(YEAR, MONTH, saturday, 10, 0), 'off'],
  ['Sun 10:00 (weekend)', beijing(YEAR, MONTH, sunday, 10, 0), 'off'],
]

let failed = 0
for (const [label, ms, expected] of cases) {
  const actual = periodOf(ms)
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`)
    failed += 1
  } else {
    console.log(`ok   ${label} -> ${actual}`)
  }
}

const countdowns = [
  ['Mon 09:00 -> 3h of peak', beijing(YEAR, MONTH, monday, 9, 0), 180],
  ['Mon 11:59 -> 1m of peak', beijing(YEAR, MONTH, monday, 11, 59), 1],
  ['Mon 12:00 -> 2h to 14:00', beijing(YEAR, MONTH, monday, 12, 0), 120],
  ['Mon 08:59 -> 1m to 09:00', beijing(YEAR, MONTH, monday, 8, 59), 1],
  ['Fri 18:00 -> weekend, 63h to Mon 09:00', beijing(YEAR, MONTH, friday, 18, 0), 63 * 60],
]
for (const [label, ms, expected] of countdowns) {
  const actual = minutesUntilSwitch(ms)
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`)
    failed += 1
  } else {
    console.log(`ok   ${label} -> ${actual} min (${humanMinutes(actual)})`)
  }
}

if (failed > 0) {
  console.error(`FAIL: ${failed} case(s) wrong`)
  process.exit(1)
}
console.log('PASS: tariff windows and countdowns')
