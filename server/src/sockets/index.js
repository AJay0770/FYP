const socketAuthMiddleware = require('./auth');
const registerRoomHandlers = require('./rooms');
const registerChatHandlers = require('./chat');
const { setIO } = require('./io');

function initSockets(io) {
  setIO(io); // make io reachable from route modules without a circular import

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    registerRoomHandlers(io, socket);
    registerChatHandlers(io, socket);
  });

  return io;
}

module.exports = { initSockets };
