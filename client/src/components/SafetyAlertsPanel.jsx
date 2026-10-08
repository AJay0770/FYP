import { useEffect, useState, useContext } from 'react'
import api from '../api/axios'
import { joinProjectRoom } from '../api/socket'
import { AuthContext } from '../context/AuthContext'
import { Badge, Card, Table, ToastRegion, useToasts, statusVariant } from './ui'

export default function SafetyAlertsPanel({ projectId }) {
  const { token } = useContext(AuthContext)
  const [alerts, setAlerts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { toasts, push, dismiss } = useToasts(8000)

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get(`/projects/${projectId}/safety-alerts?limit=50`)
        setAlerts(res.data.alerts)
        setTotal(res.data.total)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load alerts')
      } finally {
        setLoading(false)
      }
    }
    if (projectId) fetchAlerts()
  }, [projectId])

  useEffect(() => {
    if (!token || !projectId) return

    const { socket: s, stopRejoining } = joinProjectRoom(token, projectId)
    const handleAlert = (alert) => {
      // The socket may still be in rooms of projects opened earlier.
      if (alert.projectId !== projectId) return
      setAlerts((prev) => [alert, ...prev])
      setTotal((prev) => prev + 1)
      push({
        variant: 'danger',
        title: `${alert.violationType.replace('_', ' ')} detected — ${alert.worker ? alert.worker.name : 'unidentified person'}`,
        message: `${alert.camera?.name ?? 'Unknown camera'} · confidence ${Number(alert.confidenceScore).toFixed(2)}`,
      })
    }

    s.on('safety:alert', handleAlert)
    return () => {
      stopRejoining()
      s.off('safety:alert', handleAlert)
    }
  }, [projectId, token, push])

  const columns = [
    {
      key: 'violationType',
      header: 'Violation',
      render: (row) => (
        <Badge variant={statusVariant(row.violationType)}>{row.violationType.replace('_', ' ')}</Badge>
      ),
    },
    { key: 'camera', header: 'Camera', render: (row) => row.camera?.name || '—' },
    { key: 'zone', header: 'Zone', render: (row) => row.camera?.zone?.replace('_', ' ') || '—' },
    {
      key: 'worker',
      header: 'Worker',
      render: (row) =>
        row.worker ? (
          <span>
            {row.worker.name}
            {row.worker.employeeId && <span className="ds-muted"> ({row.worker.employeeId})</span>}
          </span>
        ) : (
          // No enrolled worker matched the face: still a real violation.
          <span className="ds-muted">Unidentified</span>
        ),
    },
    {
      key: 'confidenceScore',
      header: 'Confidence',
      render: (row) => Number(row.confidenceScore).toFixed(2),
    },
    { key: 'createdAt', header: 'When', render: (row) => new Date(row.createdAt).toLocaleString() },
    {
      key: 'frameImageUrl',
      header: 'Frame',
      render: (row) =>
        row.frameImageUrl ? (
          <a href={row.frameImageUrl} target="_blank" rel="noreferrer">
            <img
              src={row.frameImageUrl}
              alt={`Captured frame showing a ${row.violationType.replace('_', ' ').toLowerCase()} violation`}
              width="72"
              style={{ borderRadius: 'var(--radius-sm)', display: 'block' }}
            />
          </a>
        ) : (
          <span className="ds-muted">none</span>
        ),
    },
  ]

  return (
    <>
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
      <Card
        title="Safety alerts"
        subtitle={total ? `${total} total, newest first` : undefined}
        actions={total > 0 ? <Badge variant="danger">{total}</Badge> : null}
        flush
      >
        {loading && <p className="ds-muted" style={{ padding: 'var(--space-lg)' }}>Loading alerts…</p>}
        {!loading && error && (
          <p className="ds-field__error" role="alert" style={{ padding: 'var(--space-lg)' }}>{error}</p>
        )}
        {/* ▼ EDIT: safety alerts table - columns in "const columns" above */}
        {!loading && !error && (
          <Table columns={columns} rows={alerts} empty="No safety alerts recorded" hover={false} />
        )}
      </Card>
    </>
  )
}
