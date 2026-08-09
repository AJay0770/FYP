/**
 * Holds the Socket.io server instance so route modules can broadcast without
 * importing src/index.js (which would be a circular import, since index.js
 * imports the routes).
 *
 * initSockets() sets it during startup.
 */
let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

module.exports = { setIO, getIO };
