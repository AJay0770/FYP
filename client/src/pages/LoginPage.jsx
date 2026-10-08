import { useState, useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import { Button, Card, Input } from '../components/ui'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { login, loading } = useContext(AuthContext)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await login(email, password)
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    }
  }

  // ▼ EDIT: the "Log in" card: title, fields and button text below
  return (
    <Card title="Log in">
      <form onSubmit={handleSubmit} noValidate>
        {error && (
          <p className="ds-field__error" role="alert">{error}</p>
        )}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" disabled={loading} fullWidth>
          {loading ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </Card>
  )
}
