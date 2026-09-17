import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../api/axios'
import { connectSocket } from '../api/socket'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Select, Table, ToastRegion, useToasts, statusVariant } from '../components/ui'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

// Must match ai-service/safety_stream.py: same classes, same colours, so the
// legend here and the boxes burned into the stream cannot drift apart. The
// trained model (ai-service/TRAINING.md) has 3 classes, not the originally
// planned 4 - `head` is a bare head with no helmet, i.e. it IS the NO_HELMET
// violation signal, not a separate "no PPE" concept. There is no negative
// class for vests yet (would need person-detection + containment logic).
const CLASSES = [
  { key: 'helmet', label: 'Helmet', color: 'var(--color-success-600, #2e7d32)', hazard: false },
  { key: 'vest', label: 'Vest', color: 'var(--color-success-600, #2e7d32)', hazard: false },
  { key: 'head', label: 'No Helmet', color: 'var(--color-danger-600, #f44336)', hazard: true },
]

const BOX_SAFE = '#4caf50'
const BOX_HAZARD = '#f44336'
const POLL_INTERVAL_MS = 2000

const EMPTY_COUNTS = { helmet: 0, vest: 0, head: 0 }

function boxColor(detection) {
  return detection.hazard ? BOX_HAZARD : BOX_SAFE
}

/**
 * Draws detection boxes over the stream.
 *
 * The MJPEG already arrives with boxes burned in by the Python service, which is
 * what makes the feed correct even on a slow client. This overlay is the live
 * layer on top: it redraws from the JSON detections as they arrive, so hovering
 * and stats stay in step with what is on screen. Toggle it off to see exactly
 * what the detector produced.
 */
function DetectionOverlay({ detections, frameSize, enabled }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!enabled || !frameSize?.width || !frameSize?.height) return

    // Draw in the detector's pixel space and let CSS scale the canvas, so boxes
    // stay aligned at any tile size without recomputing on every resize.
    canvas.width = frameSize.width
    canvas.height = frameSize.height

    ctx.lineWidth = Math.max(2, frameSize.width / 400)
    ctx.font = `${Math.max(12, frameSize.width / 55)}px system-ui, sans-serif`
    ctx.textBaseline = 'top'

    detections.forEach((det) => {
      const [x1, y1, x2, y2] = det.box || []
      if ([x1, y1, x2, y2].some((v) => typeof v !== 'number')) return

      const color = boxColor(det)
      ctx.strokeStyle = color
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)

      const caption = `${det.label} ${(det.confidence * 100).toFixed(0)}%`
      const metrics = ctx.measureText(caption)
      const labelHeight = parseInt(ctx.font, 10) + 6
      const labelTop = Math.max(0, y1 - labelHeight)

      ctx.fillStyle = color
      ctx.fillRect(x1, labelTop, metrics.width + 10, labelHeight)
      ctx.fillStyle = '#fff'
      ctx.fillText(caption, x1 + 5, labelTop + 3)
    })
  }, [detections, frameSize, enabled])

  return <canvas ref={canvasRef} className="safety-stream__overlay" aria-hidden="true" />
}

export default function LiveMonitoring({ projectId }) {
  const { token } = useContext(AuthContext)
  const { toasts, push, dismiss } = useToasts(8000)

  const [cameras, setCameras] = useState([])
  const [cameraId, setCameraId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [snapshot, setSnapshot] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [streamOn, setStreamOn] = useState(true)
  const [streamFailed, setStreamFailed] = useState(false)
  const [overlay, setOverlay] = useState(false)

  // --- cameras ------------------------------------------------------------

  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get(`/projects/${projectId}/cameras`)
        if (cancelled) return
        setCameras(res.data)
        setCameraId((current) => current || res.data[0]?.id || '')
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || 'Failed to load cameras')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // --- detections: poll, and take socket pushes when they arrive ----------

  const fetchDetections = useCallback(async () => {
    if (!cameraId) return
    try {
      const res = await api.get(`/detections/latest?cameraId=${encodeURIComponent(cameraId)}`)
      setSnapshot(res.data)
      setAlerts(res.data.alerts || [])
    } catch (err) {
      // A poll failure is transient by nature — surface it in the status strip
      // rather than tearing the page down.
      setSnapshot((prev) => ({
        ...(prev || {}),
        aiService: { available: false, error: err.response?.data?.error || 'detection API unreachable' },
      }))
    }
  }, [cameraId])

  useEffect(() => {
    if (!cameraId) return
    fetchDetections()
    const timer = setInterval(fetchDetections, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [cameraId, fetchDetections])

  useEffect(() => {
    if (!token || !projectId) return
    const socket = connectSocket(token)

    const handleDetections = (payload) => {
      if (payload.cameraId !== cameraId) return
      setSnapshot((prev) => ({ ...(prev || {}), ...payload, aiService: { available: true, source: 'socket' } }))
    }

    const handleAlert = (alert) => {
      setAlerts((prev) => [alert, ...prev].slice(0, 10))
      push({
        variant: 'danger',
        title: `${alert.violationType.replace('_', ' ')} detected${alert.worker ? ` — ${alert.worker.name}` : ''}`,
        message: `${alert.camera?.name ?? 'Camera'} · confidence ${Number(alert.confidenceScore).toFixed(2)}`,
      })
    }

    socket.emit('project:join', { projectId })
    socket.on('safety:detections', handleDetections)
    socket.on('safety:alert', handleAlert)

    return () => {
      socket.off('safety:detections', handleDetections)
      socket.off('safety:alert', handleAlert)
    }
  }, [projectId, token, cameraId, push])

  // Remount the <img> on camera change: an MJPEG connection is never reused.
  useEffect(() => {
    setStreamFailed(false)
    setStreamOn(true)
    setSnapshot(null)
  }, [cameraId])

  // --- derived ------------------------------------------------------------

  const counts = snapshot?.counts || EMPTY_COUNTS
  const detections = snapshot?.detections || []
  const hazardCount = snapshot?.hazardCount ?? 0
  const aiAvailable = snapshot?.aiService?.available !== false
  const modelLoaded = snapshot?.modelLoaded === true
  const camera = cameras.find((c) => c.id === cameraId)

  const chartData = useMemo(
    () => CLASSES.map((c) => ({ name: c.label, count: counts[c.key] || 0, fill: c.hazard ? BOX_HAZARD : BOX_SAFE })),
    [counts]
  )

  const streamUrl = cameraId
    ? `${API_BASE}/stream/safety?cameraId=${encodeURIComponent(cameraId)}` +
      `&annotate=${overlay ? '0' : '1'}&token=${encodeURIComponent(token || '')}` +
      `&t=${streamOn ? 'on' : 'off'}`
    : ''

  const alertColumns = [
    {
      key: 'violationType',
      header: 'Violation',
      render: (row) => <Badge variant="danger">{row.violationType.replace('_', ' ')}</Badge>,
    },
    {
      key: 'worker',
      header: 'Worker',
      render: (row) => row.worker?.name || <span className="ds-muted">—</span>,
    },
    { key: 'confidenceScore', header: 'Confidence', render: (row) => Number(row.confidenceScore).toFixed(2) },
    { key: 'createdAt', header: 'When', render: (row) => new Date(row.createdAt).toLocaleTimeString() },
    {
      key: 'frameImageUrl',
      header: 'Frame',
      render: (row) =>
        row.frameImageUrl ? (
          <a href={row.frameImageUrl} target="_blank" rel="noreferrer">
            <img
              src={row.frameImageUrl}
              alt={`Frame showing a ${row.violationType.replace('_', ' ').toLowerCase()} violation`}
              width="64"
              style={{ borderRadius: 'var(--radius-sm)', display: 'block' }}
            />
          </a>
        ) : (
          <span className="ds-muted">none</span>
        ),
    },
  ]

  // --- render -------------------------------------------------------------

  return (
    <>
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
      <Card
        title="Live safety monitoring"
        subtitle={camera ? `${camera.name} · ${camera.zone.replace('_', ' ').toLowerCase()}` : 'AI PPE detection'}
        actions={
          hazardCount > 0 ? (
            <Badge variant="danger" dot>{hazardCount} hazard(s)</Badge>
          ) : (
            <Badge variant={aiAvailable && modelLoaded ? 'success' : 'neutral'} dot>
              {!aiAvailable ? 'Detector offline' : modelLoaded ? 'Monitoring' : 'No model'}
            </Badge>
          )
        }
      >
        {loading && <p className="ds-muted">Loading cameras…</p>}
        {!loading && error && <p className="ds-field__error" role="alert">{error}</p>}
        {!loading && !error && cameras.length === 0 && (
          <p className="ds-muted">
            No cameras registered for this project. Add one from the project settings, then start the
            detector with <code>python safety_stream.py</code>.
          </p>
        )}

        {!loading && cameras.length > 0 && (
          <>
            <div className="ds-row safety-toolbar">
              <Select
                label="Camera"
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
                options={cameras.map((c) => ({
                  value: c.id,
                  label: `${c.name} — ${c.zone.replace('_', ' ').toLowerCase()}`,
                }))}
              />
              {camera && <Badge variant={statusVariant(camera.status)} dot>{camera.status}</Badge>}
              <Button size="sm" variant="secondary" onClick={() => setStreamOn((on) => !on)}>
                {streamOn ? 'Pause stream' : 'Resume stream'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOverlay((o) => !o)}>
                {overlay ? 'Server-drawn boxes' : 'Browser-drawn boxes'}
              </Button>
            </div>

            <div className="safety-stream">
              {!streamOn ? (
                <p className="camera-tile__placeholder">Stream paused.</p>
              ) : streamFailed ? (
                <p className="camera-tile__placeholder">
                  Stream unavailable. Check that the camera is reachable and that the detection
                  service is running (<code>python safety_stream.py</code>).
                </p>
              ) : (
                <>
                  <img
                    key={streamUrl}
                    src={streamUrl}
                    alt={`Live safety detection view from ${camera?.name ?? 'the selected camera'}`}
                    onError={() => setStreamFailed(true)}
                  />
                  <DetectionOverlay
                    detections={detections}
                    frameSize={snapshot?.frameSize}
                    enabled={overlay}
                  />
                </>
              )}
            </div>

            {!aiAvailable && (
              <p className="ds-field__error" role="status">
                {snapshot?.aiService?.error || 'Detection service unreachable.'}
              </p>
            )}
            {aiAvailable && snapshot && !modelLoaded && (
              <p className="ds-muted" role="status">
                Detector is streaming without a model
                {snapshot?.modelError ? ` — ${snapshot.modelError}` : ''}. Train it with{' '}
                <code>python scripts/train_model.py</code>.
              </p>
            )}

            <div className="safety-stats">
              {CLASSES.map((cls) => (
                <div
                  key={cls.key}
                  className={`safety-stat${cls.hazard && counts[cls.key] > 0 ? ' safety-stat--hazard' : ''}`}
                >
                  <span className="safety-stat__dot" style={{ background: cls.hazard ? BOX_HAZARD : boxColorFor(cls) }} />
                  <div>
                    <div className="safety-stat__value">{counts[cls.key] ?? 0}</div>
                    <div className="ds-caption">{cls.label}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ height: 200, marginTop: 'var(--space-md)' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {snapshot?.stats && (
              <p className="ds-caption">
                {snapshot.stats.framesRead} frames · {snapshot.stats.inferences} inferences ·{' '}
                {snapshot.stats.alertsSent} alerts sent · {snapshot.stats.alertsSuppressed} suppressed
              </p>
            )}

            <h3 className="safety-section-title">Recent alerts</h3>
            <Table columns={alertColumns} rows={alerts} empty="No safety alerts yet" hover={false} />
          </>
        )}
      </Card>
    </>
  )
}

function boxColorFor(cls) {
  return cls.hazard ? BOX_HAZARD : BOX_SAFE
}
