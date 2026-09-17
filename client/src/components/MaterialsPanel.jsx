import { useContext, useEffect, useState } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Input, Modal, Select, Table, ToastRegion, useToasts } from '../components/ui'

const ENTRY_TYPE_OPTIONS = [
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CONSUMED', label: 'Consumed' },
]

const EMPTY_FORM = { name: '', category: '', entryType: 'RECEIVED', quantity: '', unitCost: '', date: '' }

export default function MaterialsPanel({ projectId }) {
  const { user } = useContext(AuthContext)
  const canManage = user?.role === 'ADMIN' || user?.role === 'ENGINEER'

  const [summary, setSummary] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { toasts, push, dismiss } = useToasts()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null) // the entry being edited, or null when adding
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

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

  useEffect(() => {
    if (projectId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const openAddForm = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setFormOpen(true)
  }

  const openEditForm = (entry) => {
    setEditing(entry)
    setForm({
      name: entry.name,
      category: entry.category,
      entryType: entry.entryType,
      quantity: String(entry.quantity),
      unitCost: String(entry.unitCost),
      date: new Date(entry.date).toISOString().slice(0, 10),
    })
    setFormError('')
    setFormOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')

    if (!form.name || !form.category || !form.quantity || !form.unitCost || !form.date) {
      setFormError('All fields are required')
      return
    }

    const payload = {
      name: form.name,
      category: form.category,
      entryType: form.entryType,
      quantity: Number(form.quantity),
      unitCost: Number(form.unitCost),
      date: form.date,
    }

    setSaving(true)
    try {
      if (editing) {
        await api.put(`/projects/${projectId}/materials/${editing.id}`, payload)
        push({ variant: 'success', title: 'Material updated' })
      } else {
        await api.post(`/projects/${projectId}/materials`, payload)
        push({ variant: 'success', title: 'Material added' })
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save material entry')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (entry) => {
    if (!window.confirm(`Delete "${entry.name}" (${entry.entryType.toLowerCase()}, ${entry.quantity})?`)) return

    setDeletingId(entry.id)
    try {
      await api.delete(`/projects/${projectId}/materials/${entry.id}`)
      push({ variant: 'success', title: 'Material deleted' })
      await load()
    } catch (err) {
      push({ variant: 'danger', title: err.response?.data?.error || 'Failed to delete material entry' })
    } finally {
      setDeletingId(null)
    }
  }

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
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            render: (r) => (
              <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                <Button size="sm" variant="ghost" onClick={() => openEditForm(r)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deletingId === r.id}
                  onClick={() => handleDelete(r)}
                >
                  {deletingId === r.id ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ]

  return (
    <Card
      title="Materials"
      subtitle={
        discrepancies > 0
          ? `${discrepancies} item(s) consumed more than was received`
          : 'Received vs consumed totals'
      }
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          {discrepancies > 0 && <Badge variant="danger">{discrepancies} discrepancy</Badge>}
          {canManage && (
            <Button size="sm" onClick={openAddForm}>
              Add material
            </Button>
          )}
        </div>
      }
    >
      <ToastRegion toasts={toasts} onDismiss={dismiss} />

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

      <Modal
        open={formOpen}
        title={editing ? 'Edit material entry' : 'Add material entry'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add entry'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} noValidate>
          {formError && <p className="ds-field__error" role="alert">{formError}</p>}
          <Input
            label="Material name"
            placeholder="Cement"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <Input
            label="Category"
            placeholder="Construction materials"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            required
          />
          <Select
            label="Type"
            options={ENTRY_TYPE_OPTIONS}
            value={form.entryType}
            onChange={(e) => setForm({ ...form, entryType: e.target.value })}
            required
          />
          <Input
            label="Quantity"
            type="number"
            step="any"
            min="0"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            required
          />
          <Input
            label="Unit cost"
            type="number"
            step="any"
            min="0"
            value={form.unitCost}
            onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
            required
          />
          <Input
            label="Date"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />
        </form>
      </Modal>
    </Card>
  )
}
