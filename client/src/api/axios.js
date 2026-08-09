import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api',
  withCredentials: true
})

// In-memory token store (no localStorage) — updated by AuthContext
let inMemoryToken = null

export const setAuthToken = (token) => {
  inMemoryToken = token
}

// Axios interceptor to attach bearer token
api.interceptors.request.use(
  (config) => {
    if (inMemoryToken) {
      config.headers.Authorization = `Bearer ${inMemoryToken}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

export default api
