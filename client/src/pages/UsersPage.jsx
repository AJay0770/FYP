import { useCallback, useEffect, useState } from 'react'
import api from '../api/axios'
import {
  Avatar, Badge, Button, Card, ErrorState, Grid, Input, PageHeader, SegmentedControl, Table, statusVariant,
} from '../components/ui'
import { PASSWORD_HINT, isPasswordValid, passwordProblem } from '../utils/password'

const EMPTY_FORM = { name: '', email: '', password: '', role: 'ENGINEER' }
const ROLE_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'ENGINEER', label: 'Engineers' },
  { value: 'CLIENT', label: 'Clients' },
  { value: 'ADMIN', label: 'Admins' },
]

/**
 * Admin-only user management: create engineer and client accounts (with the
 * password they will log in with) and see everyone. Admin accounts can't be
 * created here - the server refuses that role.
 */
export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('ALL')

  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [created, setCreated] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/users')
      setUsers(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    setCreated(null)
    try {
      const res = await api.post('/users', form)
      setCreated(res.data)
      setForm((f) => ({ ...EMPTY_FORM, role: f.role }))
      setShowPassword(false)
      await load()
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not create the account')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = form.name.trim() && form.email.trim() && isPasswordValid(form.password)
  const rows = filter === 'ALL' ? users : users.filter((u) => u.role === filter)
  const counts = users.reduce((acc, u) => ({ ...acc, [u.role]: (acc[u.role] || 0) + 1 }), {})

  const columns = [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <span className="users__person">
          <Avatar name={u.name || u.email} size={34} variant={u.role === 'ADMIN' ? 'dark' : u.role === 'ENGINEER' ? 'accent' : 'neutral'} />
          <span><strong>{u.name}</strong><span className="ds-caption">{u.email}</span></span>
        </span>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => <Badge variant={statusVariant(u.role)}>{u.role}</Badge> },
    {
      key: 'projects',
      header: 'Projects',
      align: 'right',
      render: (u) => (u.role === 'ENGINEER' ? u._count.assignedProjects : u.role === 'CLIENT' ? u._count.clientProjects : '—'),
    },
    { key: 'createdAt', header: 'Joined', render: (u) => new Date(u.createdAt).toLocaleDateString() },
  ]

  return (
    <div className="users">
      <PageHeader
        eyebrow="Admin"
        title="Users"
        subtitle="Create engineer and client accounts, and see who has access. New accounts log in with the email and password you set here."
      />

      {/* ▼ EDIT: Users page: the create-account form */}
      <Card title="Create an account" icon="user-plus">
        <form onSubmit={handleCreate} noValidate>
          <div className="users__role">
            <span className="ds-field__label">Account type</span>
            <SegmentedControl
              label="Account type"
              value={form.role}
              onChange={(role) => setForm((f) => ({ ...f, role }))}
              options={[{ value: 'ENGINEER', label: 'Engineer' }, { value: 'CLIENT', label: 'Client' }]}
            />
          </div>
          <Grid columns={3}>
            <Input label="Full name" required value={form.name} onChange={set('name')} autoComplete="off" disabled={saving} />
            <Input label="Email (login)" type="email" required icon="mail" value={form.email} onChange={set('email')} autoComplete="off" disabled={saving} />
            <div className="new-project__password">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                required
                icon="lock"
                value={form.password}
                onChange={set('password')}
                autoComplete="new-password"
                hint={PASSWORD_HINT}
                error={passwordProblem(form.password)}
                disabled={saving}
              />
              <button type="button" className="new-project__reveal" onClick={() => setShowPassword((s) => !s)} aria-pressed={showPassword}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Grid>
          {formError && <p className="ds-field__error" role="alert">{formError}</p>}
          {created && (
            <p className="users__created" role="status">
              {created.role === 'ENGINEER' ? 'Engineer' : 'Client'} account created for <strong>{created.email}</strong>.
              {created.role === 'ENGINEER' ? ' Assign them to a project from its page.' : ' Choose them as the client when creating a project.'}
            </p>
          )}
          <Button type="submit" icon="user-plus" loading={saving} disabled={!canSubmit}>
            Create {form.role === 'ENGINEER' ? 'engineer' : 'client'}
          </Button>
        </form>
      </Card>

      <Card
        title="Everyone"
        subtitle={`${users.length} account${users.length === 1 ? '' : 's'}`}
        icon="users"
        actions={
          <SegmentedControl
            label="Filter by role"
            value={filter}
            onChange={setFilter}
            options={ROLE_FILTERS.map((o) => ({ ...o, label: o.value === 'ALL' ? o.label : `${o.label} (${counts[o.value] || 0})` }))}
          />
        }
        flush
      >
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <Table columns={columns} rows={rows} loading={loading} empty="No users in this group" />
        )}
      </Card>
    </div>
  )
}
