import { useEffect, useState } from 'react'
import api from '../api/axios'
import { Badge, Card, Table } from '../components/ui'

export default function SiteUpdatesPanel({ projectId }) {
  const [updates, setUpdates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get(`/projects/${projectId}/updates`)
        setUpdates(res.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load site updates')
      } finally {
        setLoading(false)
      }
    }
    if (projectId) load()
  }, [projectId])

  const columns = [
    { key: 'description', header: 'Update' },
    {
      key: 'engineer',
      header: 'Logged by',
      render: (row) => row.engineer?.name || '—',
    },
    {
      key: 'media',
      header: 'Media',
      render: (row) =>
        row.mediaUrls?.length ? (
          <Badge variant="info">{row.mediaUrls.length} {row.mediaType.toLowerCase()}</Badge>
        ) : (
          <span className="ds-muted">none</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'When',
      render: (row) => new Date(row.createdAt).toLocaleString(),
    },
  ]

  return (
    <Card title="Site updates" subtitle="Newest first" flush>
      {loading && <p className="ds-muted" style={{ padding: 'var(--space-lg)' }}>Loading…</p>}
      {!loading && error && (
        <p className="ds-field__error" role="alert" style={{ padding: 'var(--space-lg)' }}>{error}</p>
      )}
      {!loading && !error && (
        <Table columns={columns} rows={updates} empty="No site updates logged yet" hover={false} />
      )}
    </Card>
  )
}
