const prisma = require('../utils/prisma');

/**
 * Single source of truth for project aggregations.
 *
 * Used by the analytics endpoint, the PDF generator, and the report cron, so all
 * three always report identical numbers. Every figure is computed by the database
 * (groupBy / count / raw SQL) rather than by loading rows and looping in JS.
 */
async function getProjectSummary(projectId, { startDate, endDate } = {}) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true, address: true, budgetEstimate: true },
  });

  if (!project) return null;

  // Default window: the last 30 days.
  const to = endDate ? new Date(endDate) : new Date();
  const from = startDate
    ? new Date(startDate)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const dateFilter = { gte: from, lte: to };

  const [
    siteUpdateCount,
    attendanceAgg,
    uniqueWorkerGroups,
    violationsByType,
    violationsByCamera,
    materialSummary,
  ] = await Promise.all([
    prisma.siteUpdate.count({ where: { projectId, createdAt: dateFilter } }),

    prisma.attendanceRecord.aggregate({
      where: { projectId, checkInTime: dateFilter },
      _count: { _all: true },
      _avg: { matchConfidence: true },
    }),

    prisma.attendanceRecord.groupBy({
      by: ['workerId'],
      where: { projectId, checkInTime: dateFilter },
    }),

    prisma.safetyAlert.groupBy({
      by: ['violationType'],
      where: { projectId, createdAt: dateFilter },
      _count: { _all: true },
      _avg: { confidenceScore: true },
    }),

    prisma.safetyAlert.groupBy({
      by: ['cameraId'],
      where: { projectId, createdAt: dateFilter },
      _count: { _all: true },
    }),

    prisma.$queryRaw`
      SELECT
        name,
        COALESCE(SUM(CASE WHEN "entryType" = 'RECEIVED' THEN quantity ELSE 0 END), 0)::float AS "totalReceived",
        COALESCE(SUM(CASE WHEN "entryType" = 'CONSUMED' THEN quantity ELSE 0 END), 0)::float AS "totalConsumed",
        (
          COALESCE(SUM(CASE WHEN "entryType" = 'RECEIVED' THEN quantity ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN "entryType" = 'CONSUMED' THEN quantity ELSE 0 END), 0)
        )::float AS "difference",
        (
          COALESCE(SUM(CASE WHEN "entryType" = 'CONSUMED' THEN quantity ELSE 0 END), 0)
          > COALESCE(SUM(CASE WHEN "entryType" = 'RECEIVED' THEN quantity ELSE 0 END), 0)
        ) AS "discrepancy",
        COALESCE(SUM(CASE WHEN "entryType" = 'RECEIVED' THEN quantity * "unitCost" ELSE 0 END), 0)::float AS "totalCost"
      FROM material_entries
      WHERE "projectId" = ${projectId}
        AND date >= ${from} AND date <= ${to}
      GROUP BY name
      ORDER BY name
    `,
  ]);

  // Resolve camera names for the per-camera violation breakdown.
  const cameraIds = violationsByCamera.map((v) => v.cameraId);
  const cameras = cameraIds.length
    ? await prisma.camera.findMany({
        where: { id: { in: cameraIds } },
        select: { id: true, name: true, zone: true },
      })
    : [];
  const cameraById = new Map(cameras.map((c) => [c.id, c]));

  return {
    project,
    range: { from: from.toISOString(), to: to.toISOString() },

    siteUpdates: { total: siteUpdateCount },

    attendance: {
      totalCheckins: attendanceAgg._count._all,
      uniqueWorkers: uniqueWorkerGroups.length,
      avgMatchConfidence: attendanceAgg._avg.matchConfidence
        ? Number(attendanceAgg._avg.matchConfidence)
        : null,
    },

    safety: {
      totalViolations: violationsByType.reduce((sum, v) => sum + v._count._all, 0),
      byType: violationsByType.map((v) => ({
        violationType: v.violationType,
        count: v._count._all,
        avgConfidence: v._avg.confidenceScore ? Number(v._avg.confidenceScore) : null,
      })),
      byCamera: violationsByCamera.map((v) => ({
        cameraId: v.cameraId,
        cameraName: cameraById.get(v.cameraId)?.name ?? 'Unknown',
        zone: cameraById.get(v.cameraId)?.zone ?? null,
        count: v._count._all,
      })),
    },

    materials: {
      items: materialSummary,
      discrepancyCount: materialSummary.filter((m) => m.discrepancy).length,
    },
  };
}

module.exports = { getProjectSummary };
