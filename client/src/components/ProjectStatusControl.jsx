import { useContext, useState } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Badge, Icon, Spinner, statusVariant } from './ui'

const STATUSES = [
  { value: 'PLANNING', label: 'Planning' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
]

/**
 * The project's status. Admins and the project's engineers can change it
 * (the server re-checks role and assignment); clients see a read-only badge.
 * Only ACTIVE projects are included in the nightly automatic reports.
 */
export default function ProjectStatusControl({ project, onChange }) {
  const { user } = useContext(AuthContext)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canChange = user?.role === 'ADMIN' || user?.role === 'ENGINEER'
  const label = project.status.replace('_', ' ')

  if (!canChange) {
    return <Badge variant={statusVariant(project.status)} dot>{label}</Badge>
  }

  const handleChange = async (e) => {
    const status = e.target.value
    if (status === project.status) return
    setSaving(true)
    setError('')
    try {
      const res = await api.patch(`/projects/${project.id}/status`, { status })
      onChange(res.data.status)
    } catch (err) {
      // 402: reopening a Completed project would go over the plan's limit.
      setError(err.response?.data?.message || err.response?.data?.error || 'Could not change the status')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="status-control">
      <label className={`status-control__pill status-control__pill--${statusVariant(project.status)}`}>
        <span className="ds-visually-hidden">Project status</span>
        {saving ? <Spinner size={14} /> : <span className="status-control__dot" aria-hidden="true" />}
        <select value={project.status} onChange={handleChange} disabled={saving} aria-describedby={error ? 'status-error' : undefined}>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <Icon name="chevron-down" size={15} />
      </label>
      {project.status === 'COMPLETED' && !error && (
        <span className="status-control__hint">Completed projects don't count towards the plan's project limit</span>
      )}
      {project.status !== 'ACTIVE' && project.status !== 'COMPLETED' && !error && (
        <span className="status-control__hint">Nightly reports run only for Active projects</span>
      )}
      {error && <span id="status-error" className="ds-field__error" role="alert">{error}</span>}
    </div>
  )
}
