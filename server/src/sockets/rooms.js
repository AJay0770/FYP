const { userHasProjectAccess } = require('../utils/projectAccess');

function registerRoomHandlers(io, socket) {
  socket.on('project:join', async (payload) => {
    try {
      const projectId = typeof payload === 'string' ? payload : payload?.projectId;

      if (!projectId) {
        return socket.emit('error', { message: 'projectId is required' });
      }

      const hasAccess = await userHasProjectAccess(projectId, socket.user);
      if (!hasAccess) {
        return socket.emit('error', { message: 'Forbidden: no access to this project' });
      }

      socket.join(`project:${projectId}`);
      socket.emit('project:joined', { projectId });
    } catch (err) {
      console.error('project:join error:', err);
      socket.emit('error', { message: 'Internal server error' });
    }
  });
}

module.exports = registerRoomHandlers;
