const prisma = require('../utils/prisma');

function registerChatHandlers(io, socket) {
  socket.on('chat:send', async (payload) => {
    try {
      const { projectId, content, fileUrl, mediaAssetId } = payload || {};

      // A shared media item stands on its own - it doesn't need a typed
      // caption the way a plain text message needs actual text.
      if (!projectId || (!content && !mediaAssetId)) {
        return socket.emit('error', { message: 'projectId and (content or mediaAssetId) are required' });
      }

      const room = `project:${projectId}`;
      if (!socket.rooms.has(room)) {
        return socket.emit('error', { message: 'Join the project room before sending messages' });
      }

      let resolvedFileUrl = fileUrl || null;

      if (mediaAssetId) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
        // A media item can only be shared into the project it actually
        // belongs to - never trust the id alone.
        if (!asset || asset.projectId !== projectId) {
          return socket.emit('error', { message: 'Media item not found for this project' });
        }
        resolvedFileUrl = asset.url;
      }

      const message = await prisma.chatMessage.create({
        data: {
          projectId,
          senderId: socket.user.userId,
          content: content || '',
          fileUrl: resolvedFileUrl,
          mediaAssetId: mediaAssetId || null,
        },
        include: {
          sender: { select: { id: true, name: true, role: true } },
          mediaAsset: { select: { id: true, type: true, caption: true } },
        },
      });

      io.to(room).emit('chat:message', message);
    } catch (err) {
      console.error('chat:send error:', err);
      socket.emit('error', { message: 'Internal server error' });
    }
  });
}

module.exports = registerChatHandlers;
