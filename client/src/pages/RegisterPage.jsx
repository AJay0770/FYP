import { useState, useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import { Button, Card, Input } from '../components/ui'
import { PASSWORD_HINT, isPasswordValid, passwordProblem } from '../utils/password'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const { register, loading } = useContext(AuthContext)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    try {
      await register(name, email, password)
      setSuccess(true)
      setName('')
      setEmail('')
      setPassword('')
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed')
    }
  }

  // ▼ EDIT: the "Create an account" card: title, subtitle, fields and button text below
  return (
    <Card title="Create an account" subtitle="New accounts start with the CLIENT role">
      <form onSubmit={handleSubmit} noValidate>
        {error && <p className="ds-field__error" role="alert">{error}</p>}
        {success && (
          <p className="ds-field__hint" role="status">Registration successful. Please log in.</p>
        )}
        <Input
          label="Full name"
          autoComplete="name"
          placeholder="Jane Doe"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
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
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={PASSWORD_HINT}
          error={passwordProblem(password)}
          required
        />
        <Button type="submit" variant="secondary" disabled={loading || !isPasswordValid(password)} fullWidth>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </Card>
  )
}
