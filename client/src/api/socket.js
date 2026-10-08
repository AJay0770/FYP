import { io } from 'socket.io-client'

const SOCKET_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/api\/?$/, '')

// Singleton instance — created once per app load, never auto-connects until
// connectSocket(token) is called (e.g. after login).
const socket = io(SOCKET_URL, {
  autoConnect: false,
  withCredentials: true,
})

export function connectSocket(token) {
  socket.auth = { token }
  if (!socket.connected) {
    socket.connect()
  }
  return socket
}

/**
 * Join a project's room, and join it again after every reconnect: rooms are
 * server-side state, so a dropped connection (server restart, network blip)
 * would otherwise silently stop all realtime updates. Returns the socket and
 * a cleanup function for the effect.
 *
 * The shared socket stays in every room it has joined, so listeners still
 * receive other projects' events - check the payload's projectId.
 */
export function joinProjectRoom(token, projectId) {
  const s = connectSocket(token)
  const join = () => s.emit('project:join', { projectId })
  join()
  s.on('connect', join)
  return { socket: s, stopRejoining: () => s.off('connect', join) }
}

export function disconnectSocket() {
  if (socket.connected) {
    socket.disconnect()
  }
}

export default socket
