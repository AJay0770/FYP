import { useEffect, useState, useContext } from 'react'
import api from '../api/axios'
import { connectSocket } from '../api/socket'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Input, Row, Table, ToastRegion, useToasts } from '../components/ui'

const RANGES = ['daily', 'weekly', 'monthly']

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function AttendancePage({ projectId }) {
  const { user, token } = useContext(AuthContext)
  const [range, setRange] = useState('daily')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [photos, setPhotos] = useState([])
  const [enrolling, setEnrolling] = useState(false)
  const [enrollError, setEnrollError] = useState('')
  const [enrollSuccess, setEnrollSuccess] = useState('')

  const [workers, setWorkers] = useState([])
  const [workersError, setWorkersError] = useState('')
  const [deletingWorkerId, setDeletingWorkerId] = useState(null)
  const { toasts, push, dismiss } = useToasts()

  const canEnroll = user?.role === 'ADMIN' || user?.role === 'ENGINEER'

  const loadAttendance = async (selectedRange) => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/projects/${projectId}/attendance?range=${selectedRange}`)
      setSummary(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load attendance')
    } finally {
      setLoading(false)
    }
  }

  const loadWorkers = async () => {
    setWorkersError('')
    try {
      const res = await api.get(`/projects/${projectId}/workers`)
      setWorkers(res.data)
    } catch (err) {
      setWorkersError(err.response?.data?.error || 'Failed to load enrolled workers')
    }
  }

  useEffect(() => {
    if (projectId) loadAttendance(range)
  }, [projectId, range])

  useEffect(() => {
    if (projectId && canEnroll) loadWorkers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, canEnroll])

  useEffect(() => {
    if (!token || !projectId) return
    const s = connectSocket(token)
    const handleCheckin = () => loadAttendance(range)
    s.emit('project:join', { projectId })
    s.on('attendance:checkin', handleCheckin)
    return () => s.off('attendance:checkin', handleCheckin)
  }, [projectId, token, range])

  const handleEnroll = async (e) => {
    e.preventDefault()
    setEnrolling(true)
    setEnrollError('')
    setEnrollSuccess('')
    try {
      const encoded = await Promise.all(photos.map(fileToBase64))
      await api.post(`/projects/${projectId}/workers/enroll`, { name, employeeId, photos: encoded })
      setEnrollSuccess(`Enrolled ${name}.`)
      setName('')
      setEmployeeId('')
      setPhotos([])
      await loadWorkers()
    } catch (err) {
      setEnrollError(err.response?.data?.error || 'Enrolment failed')
    } finally {
      setEnrolling(false)
    }
  }

  const handleDeleteWorker = async (worker) => {
    if (!window.confirm(`Remove ${worker.name} (${worker.employeeId})? This also deletes their attendance history.`)) return

    setDeletingWorkerId(worker.id)
    try {
      await api.delete(`/projects/${projectId}/workers/${worker.id}`)
      push({ variant: 'success', title: `${worker.name} removed` })
      await Promise.all([loadWorkers(), loadAttendance(range)])
    } catch (err) {
      push({ variant: 'danger', title: err.response?.data?.error || 'Failed to remove worker' })
    } finally {
      setDeletingWorkerId(null)
    }
  }

  const columns = [
    { key: 'name', header: 'Worker' },
    { key: 'employeeId', header: 'Employee ID', render: (r) => r.employeeId || '—' },
    {
      key: 'daysPresent',
      header: 'Days present',
      render: (r) => <Badge variant={r.daysPresent > 0 ? 'success' : 'neutral'}>{r.daysPresent}</Badge>,
    },
    {
      key: 'avgMatchConfidence',
      header: 'Avg confidence',
      render: (r) => (r.avgMatchConfidence !== null ? r.avgMatchConfidence.toFixed(3) : '—'),
    },
    {
      key: 'lastCheckIn',
      header: 'Last check-in',
      render: (r) => (r.lastCheckIn ? new Date(r.lastCheckIn).toLocaleString() : '—'),
    },
  ]

  const workerColumns = [
    { key: 'name', header: 'Worker' },
    { key: 'employeeId', header: 'Employee ID', render: (r) => r.employeeId || '—' },
    { key: 'enrolledAt', header: 'Enrolled', render: (r) => new Date(r.enrolledAt).toLocaleDateString() },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          disabled={deletingWorkerId === r.id}
          onClick={() => handleDeleteWorker(r)}
        >
          {deletingWorkerId === r.id ? 'Removing…' : 'Remove'}
        </Button>
      ),
    },
  ]

  return (
    <Card
      title="Attendance"
      subtitle={summary ? `${summary.totalCheckins} check-in(s), ${summary.uniqueWorkers} worker(s)` : undefined}
      actions={
        <Row>
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? 'primary' : 'secondary'}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
            >
              {r}
            </Button>
          ))}
        </Row>
      }
    >
      <ToastRegion toasts={toasts} onDismiss={dismiss} />

      {loading && <p className="ds-muted">Loading attendance…</p>}
      {!loading && error && <p className="ds-field__error" role="alert">{error}</p>}

      {!loading && !error && summary && (
        <Table columns={columns} rows={summary.workers} empty="No check-ins in this period" hover={false} />
      )}

      {canEnroll && (
        <details style={{ marginTop: 'var(--space-lg)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Enrol a worker</summary>
          <form onSubmit={handleEnroll} style={{ marginTop: 'var(--space-md)', maxWidth: 460 }}>
            {enrollError && <p className="ds-field__error" role="alert">{enrollError}</p>}
            {enrollSuccess && <p className="ds-field__hint" role="status">{enrollSuccess}</p>}

            <Input
              label="Worker name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Input
              label="Employee ID"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
            />
            <Input
              label="Reference photos"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotos(Array.from(e.target.files))}
              hint="Around 10 photos across different lighting gives the most reliable match"
            />
            <p className="ds-caption">{photos.length} photo(s) selected</p>
            <Button type="submit" disabled={enrolling || photos.length === 0}>
              {enrolling ? 'Enrolling…' : 'Enrol worker'}
            </Button>
          </form>

          <h4 style={{ marginTop: 'var(--space-lg)' }}>Enrolled workers</h4>
          {workersError && <p className="ds-field__error" role="alert">{workersError}</p>}
          <Table columns={workerColumns} rows={workers} empty="No workers enrolled yet" hover={false} />
        </details>
      )}
    </Card>
  )
}
