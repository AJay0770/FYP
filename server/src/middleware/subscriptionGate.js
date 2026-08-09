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

/**
 * Returns { allowed, limit, current, plan, reason }.
 * Counts projects created by this admin.
 */
async function canCreateProject(companyAdminId) {
  const subscription = await prisma.subscription.findUnique({
    where: { companyAdminId },
  });

  const current = await prisma.project.count({ where: { createdById: companyAdminId } });

  if (!subscription || subscription.status !== 'ACTIVE') {
    return {
      allowed: current < FREE_TIER_LIMIT,
      limit: FREE_TIER_LIMIT,
      current,
      plan: subscription ? `${subscription.plan} (${subscription.status})` : 'NONE',
      reason: subscription ? 'Subscription is not active' : 'No active subscription',
    };
  }

  const limit = PLAN_LIMITS[subscription.plan] ?? FREE_TIER_LIMIT;

  return {
    allowed: current < limit,
    limit,
    current,
    plan: subscription.plan,
    reason: current < limit ? null : `Plan ${subscription.plan} allows ${limit} projects`,
  };
}

/**
 * Express guard for POST /api/projects. Responds 402 Payment Required when the
 * caller is over their plan limit.
 */
async function enforceProjectLimit(req, res, next) {
  try {
    const check = await canCreateProject(req.user.userId);

    if (!check.allowed) {
      return res.status(402).json({
        error: 'Project limit reached for current plan',
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

module.exports = { canCreateProject, enforceProjectLimit, PLAN_LIMITS, FREE_TIER_LIMIT };
