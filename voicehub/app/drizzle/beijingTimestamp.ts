import { customType } from 'drizzle-orm/pg-core'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(utc)
dayjs.extend(timezone)

// Song.createdAt is a legacy timestamp WITHOUT time zone containing Beijing
// wall time (including database now() defaults). Drizzle's standard timestamp
// decoder assumes UTC, which would add eight hours again when displaying it.
// Keep the stored values unchanged; expose a real instant to every consumer.
export const beijingTimestamp = customType<{ data: Date; driverData: string }>({
  dataType: () => 'timestamp',
  fromDriver: value => dayjs.tz(value, 'Asia/Shanghai').toDate(),
  toDriver: value => dayjs(value).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss.SSS'),
})
