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

export function disconnectSocket() {
  if (socket.connected) {
    socket.disconnect()
  }
}

export default socket
