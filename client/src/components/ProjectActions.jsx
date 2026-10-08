import { useContext, useState } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Button, Grid, Icon, Input, Modal, Row } from './ui'

// <input type="date"> wants YYYY-MM-DD; the API returns full ISO timestamps.
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '')

const formFrom = (project) => ({
  name: project.name,
  address: project.address,
  startDate: toDateInput(project.startDate),
  expectedCompletionDate: toDateInput(project.expectedCompletionDate),
  // Prisma Decimal arrives as a string - keep it as the input's text value.
  budgetEstimate: project.budgetEstimate == null ? '' : String(project.budgetEstimate),
})

/**
 * Edit (admins and the project's engineers) and Delete (admins only) for a
 * project; the server re-checks both. Clients see nothing. Status has its own
 * control (ProjectStatusControl).
 */
export default function ProjectActions({ project, onUpdated, onDeleted }) {
  const { user } = useContext(AuthContext)
  const [mode, setMode] = useState(null) // null | 'edit' | 'delete'
  const [form, setForm] = useState(() => formFrom(project))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (user?.role !== 'ADMIN' && user?.role !== 'ENGINEER') return null

  const open = (next) => {
    if (next === 'edit') setForm(formFrom(project))
    setError('')
    setMode(next)
  }
  const close = () => { if (!saving) setMode(null) }
  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const canSave = form.name.trim() && form.address.trim() && form.startDate && form.expectedCompletionDate &&
    form.budgetEstimate !== '' && form.expectedCompletionDate >= form.startDate

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await api.put(`/projects/${project.id}`, {
        name: form.name.trim(),
        address: form.address.trim(),
        startDate: form.startDate,
        expectedCompletionDate: form.expectedCompletionDate,
        budgetEstimate: Number(form.budgetEstimate),
      })
      onUpdated(res.data)
      setMode(null)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the project')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    setError('')
    try {
      await api.delete(`/projects/${project.id}`)
      setMode(null)
      onDeleted()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete the project')
      setSaving(false)
    }
  }

  return (
    <>
      <Row>
        <Button size="sm" variant="secondary" icon="pencil" onClick={() => open('edit')}>Edit</Button>
        {/* Admin only: engineers finish a project by marking it Completed. */}
        {user.role === 'ADMIN' && (
          <Button size="sm" variant="ghost" icon="trash-2" onClick={() => open('delete')}>Delete</Button>
        )}
      </Row>

      <Modal
        open={mode === 'edit'}
        title="Edit project"
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
            <Button type="submit" form="edit-project-form" loading={saving} disabled={!canSave}>Save changes</Button>
          </>
        }
      >
        <form id="edit-project-form" onSubmit={save} noValidate>
          <Input label="Project name" required value={form.name} onChange={setField('name')} maxLength={120} />
          <Input label="Address" required icon="map-pin" value={form.address} onChange={setField('address')} />
          <Grid columns={2}>
            <Input label="Start date" type="date" required value={form.startDate} onChange={setField('startDate')} />
            <Input
              label="Expected completion"
              type="date"
              required
              min={form.startDate}
              value={form.expectedCompletionDate}
              onChange={setField('expectedCompletionDate')}
              error={form.expectedCompletionDate && form.expectedCompletionDate < form.startDate ? 'Cannot be before the start date' : ''}
            />
          </Grid>
          <Input label="Budget (PKR)" type="number" required min="0" step="1000" value={form.budgetEstimate} onChange={setField('budgetEstimate')} />
          {error && <p className="ds-field__error" role="alert"><Icon name="circle-alert" size={16} /> {error}</p>}
        </form>
      </Modal>

      <Modal
        open={mode === 'delete'}
        title="Delete project"
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
            <Button variant="danger" icon="trash-2" loading={saving} onClick={remove}>Delete project</Button>
          </>
        }
      >
        <p>
          Delete <strong>{project.name}</strong>? Its cameras, site updates, materials, chat, workers,
          attendance, safety alerts and reports are deleted with it. This cannot be undone.
        </p>
        <p className="ds-muted">The client's login account is kept.</p>
        {error && <p className="ds-field__error" role="alert"><Icon name="circle-alert" size={16} /> {error}</p>}
      </Modal>
    </>
  )
}
