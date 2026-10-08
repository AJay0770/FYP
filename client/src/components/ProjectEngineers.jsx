import { useContext, useEffect, useState } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Avatar, Button, Icon, Modal, Spinner, Tooltip } from './ui'

/**
 * Engineers on a project, shown as avatars. Admins can assign another
 * engineer (POST /projects/:id/assign-engineer) or take one off the project
 * (DELETE /projects/:id/engineers/:engineerId) - both admin-only on the server.
 */
export default function ProjectEngineers({ project, onAssigned, onRemoved }) {
  const { user } = useContext(AuthContext)
  const isAdmin = user?.role === 'ADMIN'
  const [allEngineers, setAllEngineers] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(null) // the assignment row being confirmed

  useEffect(() => {
    if (!isAdmin) return
    api.get('/users', { params: { role: 'ENGINEER' } })
      .then((res) => setAllEngineers(res.data))
      .catch(() => setAllEngineers([]))
  }, [isAdmin])

  const assigned = project.engineers || []
  const assignedIds = new Set(assigned.map((e) => e.engineerId))
  const available = (allEngineers || []).filter((e) => !assignedIds.has(e.id))
  const nameOf = (row) => row?.engineer?.name || row?.engineer?.email || 'this engineer'

  const assign = async (e) => {
    const engineerId = e.target.value
    if (!engineerId) return
    setSaving(true)
    setError('')
    try {
      const res = await api.post(`/projects/${project.id}/assign-engineer`, { engineerId })
      const engineer = allEngineers.find((x) => x.id === engineerId)
      onAssigned({ ...res.data, engineer: { id: engineer.id, name: engineer.name, email: engineer.email } })
    } catch (err) {
      setError(err.response?.data?.error || 'Could not assign the engineer')
    } finally {
      setSaving(false)
    }
  }

  const pickToRemove = (e) => {
    const row = assigned.find((a) => a.engineerId === e.target.value)
    if (row) {
      setError('')
      setRemoving(row)
    }
  }

  const remove = async () => {
    setSaving(true)
    setError('')
    try {
      await api.delete(`/projects/${project.id}/engineers/${removing.engineerId}`)
      onRemoved(removing.engineerId)
      setRemoving(null)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove the engineer')
      setRemoving(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="project-engineers">
      <span className="project-engineers__label"><Icon name="hard-hat" size={15} /> Engineers</span>
      {assigned.length === 0 ? (
        <span className="ds-muted">None assigned</span>
      ) : (
        <span className="project-engineers__avatars">
          {assigned.map((e) => (
            <Tooltip key={e.engineerId} label={e.engineer ? `${e.engineer.name} · ${e.engineer.email}` : 'Engineer'} side="bottom">
              <span tabIndex={0} aria-label={e.engineer?.name || 'Engineer'}>
                <Avatar name={e.engineer?.name || e.engineer?.email || 'E'} size={30} />
              </span>
            </Tooltip>
          ))}
        </span>
      )}
      {isAdmin && allEngineers && available.length > 0 && (
        <label className="project-engineers__assign">
          <span className="ds-visually-hidden">Assign an engineer</span>
          {saving ? <Spinner size={14} /> : <Icon name="user-plus" size={15} />}
          <select value="" onChange={assign} disabled={saving}>
            <option value="">Assign engineer…</option>
            {available.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.email}</option>)}
          </select>
        </label>
      )}
      {isAdmin && assigned.length > 0 && (
        <label className="project-engineers__assign">
          <span className="ds-visually-hidden">Remove an engineer from this project</span>
          <Icon name="user-minus" size={15} />
          <select value="" onChange={pickToRemove} disabled={saving}>
            <option value="">Remove engineer…</option>
            {assigned.map((e) => <option key={e.engineerId} value={e.engineerId}>{nameOf(e)}{e.engineer?.email ? ` — ${e.engineer.email}` : ''}</option>)}
          </select>
        </label>
      )}
      {error && <span className="ds-field__error" role="alert">{error}</span>}

      <Modal
        open={Boolean(removing)}
        title="Remove engineer"
        onClose={() => { if (!saving) setRemoving(null) }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={saving}>Cancel</Button>
            <Button variant="danger" icon="user-minus" loading={saving} onClick={remove}>Remove from project</Button>
          </>
        }
      >
        <p>
          Take <strong>{nameOf(removing)}</strong> off <strong>{project.name}</strong>? They lose access to
          the project straight away. Their account, and the updates and materials they recorded here, are kept.
        </p>
      </Modal>
    </div>
  )
}
