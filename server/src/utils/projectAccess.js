const prisma = require('./prisma');

async function isEngineerAssigned(projectId, engineerId) {
  const assignment = await prisma.projectEngineer.findUnique({
    where: { projectId_engineerId: { projectId, engineerId } },
  });
  return !!assignment;
}

// Same role-scoping rules as the Projects module: ADMIN sees everything,
// ENGINEER only assigned projects, CLIENT only their own.
async function userHasProjectAccess(projectId, user) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { engineers: true },
  });

  if (!project) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'ENGINEER') return project.engineers.some((e) => e.engineerId === user.userId);
  return project.clientId === user.userId;
}

// Clients an engineer is related to: the clients of projects they are assigned
// to. An engineer may see and pick only these - never the company's whole
// client list.
async function clientIdsForEngineer(engineerId) {
  const projects = await prisma.project.findMany({
    where: { engineers: { some: { engineerId } } },
    select: { clientId: true },
    distinct: ['clientId'],
  });
  return projects.map((p) => p.clientId);
}

module.exports = { isEngineerAssigned, userHasProjectAccess, clientIdsForEngineer };
