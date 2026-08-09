import { useEffect, useState, useContext } from 'react'
import api from '../api/axios'
import { connectSocket } from '../api/socket'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Input, Row, Table } from '../components/ui'

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

  useEffect(() => {
    if (projectId) loadAttendance(range)
  }, [projectId, range])

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
    } catch (err) {
      setEnrollError(err.response?.data?.error || 'Enrolment failed')
    } finally {
      setEnrolling(false)
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
        </details>
      )}
    </Card>
  )
}
