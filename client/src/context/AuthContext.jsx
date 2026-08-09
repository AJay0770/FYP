import { createContext, useState, useCallback } from 'react'
import api, { setAuthToken } from '../api/axios'

export const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(false)

  const register = useCallback(async (name, email, password) => {
    setLoading(true)
    try {
      const res = await api.post('/auth/register', { name, email, password })
      return res.data
    } finally {
      setLoading(false)
    }
  }, [])

  const login = useCallback(async (email, password) => {
    setLoading(true)
    try {
      const res = await api.post('/auth/login', { email, password })
      setToken(res.data.accessToken)
      setUser(res.data.user)
      setAuthToken(res.data.accessToken)
      return res.data
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    setLoading(true)
    try {
      await api.post('/auth/logout')
    } finally {
      setToken(null)
      setUser(null)
      setAuthToken(null)
      setLoading(false)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}
