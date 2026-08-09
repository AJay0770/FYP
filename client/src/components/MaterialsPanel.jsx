import { useEffect, useState } from 'react'
import api from '../api/axios'
import { Badge, Card, Table } from '../components/ui'

export default function MaterialsPanel({ projectId }) {
  const [summary, setSummary] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [summaryRes, entriesRes] = await Promise.all([
          api.get(`/projects/${projectId}/materials/summary`),
          api.get(`/projects/${projectId}/materials`),
        ])
        setSummary(summaryRes.data)
        setEntries(entriesRes.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load materials')
      } finally {
        setLoading(false)
      }
    }
    if (projectId) load()
  }, [projectId])

  const discrepancies = summary.filter((row) => row.discrepancy).length

  const summaryColumns = [
    { key: 'name', header: 'Material' },
    { key: 'totalReceived', header: 'Received', render: (r) => r.totalReceived.toLocaleString() },
    { key: 'totalConsumed', header: 'Consumed', render: (r) => r.totalConsumed.toLocaleString() },
    {
      key: 'difference',
      header: 'Remaining',
      render: (r) => (
        <span style={r.difference < 0 ? { color: 'var(--color-danger)', fontWeight: 600 } : undefined}>
          {r.difference.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'discrepancy',
      header: 'Status',
      render: (r) =>
        r.discrepancy ? (
          <Badge variant="danger">Discrepancy</Badge>
        ) : (
          <Badge variant="success">Balanced</Badge>
        ),
    },
  ]

  const entryColumns = [
    { key: 'name', header: 'Material' },
    { key: 'category', header: 'Category' },
    {
      key: 'entryType',
      header: 'Type',
      render: (r) => <Badge variant={r.entryType === 'RECEIVED' ? 'success' : 'warning'}>{r.entryType}</Badge>,
    },
    { key: 'quantity', header: 'Qty', render: (r) => Number(r.quantity).toLocaleString() },
    { key: 'unitCost', header: 'Unit cost', render: (r) => Number(r.unitCost).toFixed(2) },
    { key: 'date', header: 'Date', render: (r) => new Date(r.date).toLocaleDateString() },
  ]

  return (
    <Card
      title="Materials"
      subtitle={
        discrepancies > 0
          ? `${discrepancies} item(s) consumed more than was received`
          : 'Received vs consumed totals'
      }
      actions={discrepancies > 0 ? <Badge variant="danger">{discrepancies} discrepancy</Badge> : null}
    >
      {loading && <p className="ds-muted">Loading…</p>}
      {!loading && error && <p className="ds-field__error" role="alert">{error}</p>}

      {!loading && !error && (
        <>
          <h4>Summary</h4>
          <Table columns={summaryColumns} rows={summary} empty="No material entries" hover={false} />

          <h4 style={{ marginTop: 'var(--space-lg)' }}>Entries</h4>
          <Table columns={entryColumns} rows={entries} empty="No entries logged" hover={false} />
        </>
      )}
    </Card>
  )
}
