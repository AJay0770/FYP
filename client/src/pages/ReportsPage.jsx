import { useEffect, useState, useContext } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Row, Table } from '../components/ui'

export default function ReportsPage({ projectId }) {
  const { user } = useContext(AuthContext)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/projects/${projectId}/reports`)
      setReports(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectId) load()
  }, [projectId])

  const generate = async (reportType) => {
    setGenerating(true)
    setMessage('')
    try {
      await api.post(`/projects/${projectId}/reports/generate-now`, { reportType })
      setMessage(`${reportType} report generated.`)
      await load()
    } catch (err) {
      setMessage(err.response?.data?.error || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const columns = [
    {
      key: 'reportType',
      header: 'Type',
      render: (r) => <Badge variant={r.reportType === 'DAILY' ? 'info' : 'neutral'}>{r.reportType}</Badge>,
    },
    { key: 'generatedAt', header: 'Generated', render: (r) => new Date(r.generatedAt).toLocaleString() },
    {
      key: 'pdfUrl',
      header: 'Download',
      render: (r) => (
        <a href={r.pdfUrl} target="_blank" rel="noreferrer">
          PDF
          <span className="ds-visually-hidden">
            {' '}for the {r.reportType.toLowerCase()} report generated on{' '}
            {new Date(r.generatedAt).toLocaleDateString()}
          </span>
        </a>
      ),
    },
  ]

  return (
    <Card
      title="Reports"
      subtitle="Generated automatically daily and weekly, or on demand"
      actions={
        user?.role === 'ADMIN' ? (
          <Row>
            <Button size="sm" variant="secondary" onClick={() => generate('DAILY')} disabled={generating}>
              {generating ? 'Generating…' : 'Generate daily'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => generate('WEEKLY')} disabled={generating}>
              Generate weekly
            </Button>
          </Row>
        ) : null
      }
      flush
    >
      {message && <p className="ds-field__hint" role="status" style={{ padding: 'var(--space-md) var(--space-lg) 0' }}>{message}</p>}
      {loading && <p className="ds-muted" style={{ padding: 'var(--space-lg)' }}>Loading reports…</p>}
      {!loading && error && (
        <p className="ds-field__error" role="alert" style={{ padding: 'var(--space-lg)' }}>{error}</p>
      )}
      {!loading && !error && (
        <Table columns={columns} rows={reports} empty="No reports generated yet" hover={false} />
      )}
    </Card>
  )
}
