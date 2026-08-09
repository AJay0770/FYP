const prisma = require('../utils/prisma');

function registerChatHandlers(io, socket) {
  socket.on('chat:send', async (payload) => {
    try {
      const { projectId, content, fileUrl } = payload || {};

      if (!projectId || !content) {
        return socket.emit('error', { message: 'projectId and content are required' });
      }

      const room = `project:${projectId}`;
      if (!socket.rooms.has(room)) {
        return socket.emit('error', { message: 'Join the project room before sending messages' });
      }

      const message = await prisma.chatMessage.create({
        data: {
          projectId,
          senderId: socket.user.userId,
          content,
          fileUrl: fileUrl || null,
        },
        include: { sender: { select: { id: true, name: true, role: true } } },
      });

      io.to(room).emit('chat:message', message);
    } catch (err) {
      console.error('chat:send error:', err);
      socket.emit('error', { message: 'Internal server error' });
    }
  });
}

module.exports = registerChatHandlers;
