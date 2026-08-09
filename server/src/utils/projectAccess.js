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

module.exports = { isEngineerAssigned, userHasProjectAccess };
