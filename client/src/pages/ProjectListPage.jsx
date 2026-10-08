import { useEffect, useState, useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import api from '../api/axios'
import { Badge, Button, Card, Table, statusVariant } from '../components/ui'

export default function ProjectListPage({ onSelectProject, onCreateProject }) {
  const { user } = useContext(AuthContext)
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchProjects = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get('/projects')
        setProjects(res.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load projects')
      } finally {
        setLoading(false)
      }
    }
    fetchProjects()
  }, [])

  const columns = [
    { key: 'name', header: 'Project' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge variant={statusVariant(row.status)}>{row.status.replace('_', ' ')}</Badge>,
    },
    { key: 'client', header: 'Client', render: (row) => row.client?.email || '—' },
    { key: 'address', header: 'Location', render: (row) => row.address },
  ]

  // ▼ EDIT: Projects page: card title/subtitle, the "New project" button and the columns list above (const columns)
  return (
    <Card
      title="Projects"
      subtitle={user?.role === 'ADMIN' ? 'All projects' : 'Projects you have access to'}
      actions={
        // Admins and engineers create projects (limit set by the plan - the
        // create page shows the upgrade notice when it is reached).
        user?.role === 'ADMIN' || user?.role === 'ENGINEER' ? (
          <Button size="sm" icon="plus" onClick={onCreateProject}>New project</Button>
        ) : null
      }
      flush
    >
      {loading && <p className="ds-muted" style={{ padding: 'var(--space-lg)' }}>Loading projects…</p>}
      {!loading && error && (
        <p className="ds-field__error" role="alert" style={{ padding: 'var(--space-lg)' }}>{error}</p>
      )}
      {/* ▼ EDIT: projects table - change columns in "const columns" near the top of this file */}
      {!loading && !error && (
        <Table
          columns={columns}
          rows={projects}
          empty="No projects available"
          onRowClick={(row) => onSelectProject(row.id)}
        />
      )}
    </Card>
  )
}
