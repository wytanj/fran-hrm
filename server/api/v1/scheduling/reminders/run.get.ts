import { handleReminderRun } from '../../../../utils/reminderRun'

// GET variant exists because Vercel cron jobs are plain GETs carrying
// `Authorization: Bearer $CRON_SECRET`. Same behaviour as the POST.
export default defineEventHandler((event) => handleReminderRun(event))
