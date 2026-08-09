const cron = require('node-cron');
const prisma = require('../utils/prisma');
const { generateReport } = require('../services/reportGenerator');
const { sendReportEmail } = require('../services/emailService');

// UTC midnight of the local calendar day (see routes/internal/attendance.js for
// why local midnight is wrong here).
function localDayUtc(offsetDays = 0) {
  const now = new Date();
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day;
}

/**
 * Generate a report for every ACTIVE project and email it to that project's client.
 * Exported so it can be invoked directly (tests, manual runs) rather than only on
 * the cron schedule.
 */
async function runReportBatch(reportType) {
  const days = reportType === 'WEEKLY' ? 7 : 1;
  const startDate = localDayUtc(-days);
  const endDate = localDayUtc(0);

  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    include: { client: { select: { email: true, name: true } } },
  });

  const results = [];

  for (const project of projects) {
    try {
      const { report, summary } = await generateReport(project.id, reportType, {
        startDate,
        endDate,
      });

      let email = { sent: false, skipped: true, reason: 'no client email' };
      if (project.client?.email) {
        email = await sendReportEmail({
          to: project.client.email,
          projectName: project.name,
          reportType,
          pdfUrl: report.pdfUrl,
          range: summary.range,
        });
      }

      results.push({ projectId: project.id, reportId: report.id, email });
      console.log(`[reportCron] ${reportType} report for "${project.name}" -> ${report.pdfUrl}`);
    } catch (err) {
      // One failing project must not abort the batch for the others.
      console.error(`[reportCron] failed for project ${project.id}:`, err.message);
      results.push({ projectId: project.id, error: err.message });
    }
  }

  return results;
}

function registerReportJobs() {
  const timezone = process.env.CRON_TIMEZONE || 'Asia/Karachi';

  // Daily at midnight — covers the day that just ended.
  const daily = cron.schedule(
    '0 0 * * *',
    () => {
      console.log('[reportCron] running DAILY batch');
      runReportBatch('DAILY').catch((err) => console.error('[reportCron] daily batch:', err));
    },
    { timezone }
  );

  // Weekly on Sunday at midnight — covers the previous 7 days.
  const weekly = cron.schedule(
    '0 0 * * 0',
    () => {
      console.log('[reportCron] running WEEKLY batch');
      runReportBatch('WEEKLY').catch((err) => console.error('[reportCron] weekly batch:', err));
    },
    { timezone }
  );

  console.log(`[reportCron] scheduled DAILY (0 0 * * *) and WEEKLY (0 0 * * 0) in ${timezone}`);
  return { daily, weekly };
}

module.exports = { registerReportJobs, runReportBatch };
