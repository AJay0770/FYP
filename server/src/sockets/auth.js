const { verifyJWT } = require('../middleware/auth');

// Socket.io middleware: verifies the JWT sent in the handshake (auth.token),
// reusing the exact same verifyJWT used by the Express authenticateToken middleware.
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  const user = verifyJWT(token, process.env.JWT_SECRET);
  if (!user) {
    return next(new Error('Invalid or expired token'));
  }

  socket.user = user; // { userId, role }
  next();
}

module.exports = socketAuthMiddleware;
