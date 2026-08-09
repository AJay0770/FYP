import { useEffect, useState, useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import api from '../api/axios'
import { Badge, Button, Card, Table, statusVariant } from '../components/ui'

export default function ProjectListPage({ onSelectProject }) {
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

  return (
    <Card
      title="Projects"
      subtitle={user?.role === 'ADMIN' ? 'All projects' : 'Projects you have access to'}
      actions={user?.role === 'ADMIN' ? <Button size="sm">Create project</Button> : null}
      flush
    >
      {loading && <p className="ds-muted" style={{ padding: 'var(--space-lg)' }}>Loading projects…</p>}
      {!loading && error && (
        <p className="ds-field__error" role="alert" style={{ padding: 'var(--space-lg)' }}>{error}</p>
      )}
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
