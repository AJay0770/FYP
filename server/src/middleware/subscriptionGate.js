const prisma = require('../utils/prisma');

// Project limits per plan. ENTERPRISE is unlimited.
const PLAN_LIMITS = {
  BASIC: 5,
  PRO: 20,
  ENTERPRISE: Infinity,
};

// Companies with no subscription at all still get a small allowance so the
// product is usable before billing is set up. Tighten if that's not desired.
const FREE_TIER_LIMIT = 2;

// Engineers can create projects too. Their allowance follows the company's
// plan (the admin's active subscription - this app is single-company); with
// no active plan they get this many.
const ENGINEER_DEFAULT_LIMIT = 5;

function upgradeMessage(role, limit) {
  const allows = `Your plan allows ${limit} open project${limit === 1 ? '' : 's'} at a time. Mark a finished project Completed to free a slot`;
  return role === 'ADMIN'
    ? `${allows}, or upgrade the plan in Billing.`
    : `${allows}, or ask your admin to upgrade the plan.`;
}

/**
 * Projects that count against the plan: those this user created that are not
 * COMPLETED. The limit is on projects running at a time, so finishing one
 * frees a slot without deleting its history.
 */
function countOpenProjects(userId) {
  return prisma.project.count({ where: { createdById: userId, status: { not: 'COMPLETED' } } });
}

/**
 * Returns { allowed, limit, current, plan, reason, message }.
 * `current` is the user's open (not COMPLETED) projects.
 *
 * `user` is { userId, role }; a bare id string is treated as an ADMIN, which
 * is what older callers passed.
 */
async function canCreateProject(user) {
  const { userId, role } = typeof user === 'string' ? { userId: user, role: 'ADMIN' } : user;
  const current = await countOpenProjects(userId);

  let subscription;
  let fallbackLimit;
  if (role === 'ENGINEER') {
    subscription = await prisma.subscription.findFirst({
      where: { status: 'ACTIVE', companyAdmin: { role: 'ADMIN' } },
      orderBy: { startDate: 'desc' },
    });
    fallbackLimit = ENGINEER_DEFAULT_LIMIT;
  } else {
    subscription = await prisma.subscription.findUnique({ where: { companyAdminId: userId } });
    fallbackLimit = FREE_TIER_LIMIT;
  }

  const active = subscription && subscription.status === 'ACTIVE';
  const limit = active ? PLAN_LIMITS[subscription.plan] ?? fallbackLimit : fallbackLimit;
  const allowed = current < limit;

  let reason = null;
  if (!allowed) {
    if (active) reason = `Plan ${subscription.plan} allows ${limit} projects`;
    else reason = subscription ? 'Subscription is not active' : 'No active subscription';
  }

  return {
    allowed,
    limit,
    current,
    plan: active ? subscription.plan : subscription ? `${subscription.plan} (${subscription.status})` : 'NONE',
    reason,
    message: allowed ? null : upgradeMessage(role, limit),
  };
}

/**
 * Express guard for POST /api/projects. Responds 402 Payment Required when the
 * caller is over their plan limit.
 */
async function enforceProjectLimit(req, res, next) {
  try {
    const check = await canCreateProject(req.user);

    if (!check.allowed) {
      return res.status(402).json({
        error: 'Project limit reached for current plan',
        message: check.message,
        plan: check.plan,
        limit: check.limit === Infinity ? 'unlimited' : check.limit,
        current: check.current,
        reason: check.reason,
      });
    }

    next();
  } catch (err) {
    console.error('Subscription gate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { canCreateProject, countOpenProjects, enforceProjectLimit, PLAN_LIMITS, FREE_TIER_LIMIT, ENGINEER_DEFAULT_LIMIT };
