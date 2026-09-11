import { handleReminderRun } from '../../../../utils/reminderRun'

// Fire today's availability reminders (per Scheduling rules). Body/query:
// { date?: 'YYYY-MM-DD', dry_run?: boolean }. See server/utils/reminderRun.ts
// for the two auth paths (CRON_SECRET vs roster:write).
export default defineEventHandler((event) => handleReminderRun(event))
