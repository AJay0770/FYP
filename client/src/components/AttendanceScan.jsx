import { useEffect, useRef, useState } from 'react'
import api from '../api/axios'
import { Badge, Button, Icon, ProgressBar, Select } from './ui'
import useCameraDevice, { deviceLabel, deviceNoun, holderLabel } from './useCameraDevice'

// Must match SCAN_SECONDS in server/src/routes/attendance.js (drives the countdown only).
const SCAN_SECONDS = 12

const STATUS_TEXT = {
  checked_in: { label: 'Checked in', variant: 'success' },
  already_checked_in: { label: 'Already checked in today', variant: 'info' },
  error: { label: 'Could not record', variant: 'danger' },
}

/**
 * "Detect & mark attendance": asks the detection service to look for enrolled
 * workers' faces on a camera for a few seconds and check them in. Uses the
 * frames the service is already reading, so a laptop-webcam camera must hold
 * the webcam (Live monitoring > "Use webcam here").
 */
export default function AttendanceScan({ projectId, onDone }) {
  const [cameras, setCameras] = useState(null)
  const [cameraId, setCameraId] = useState('')
  const [scanning, setScanning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    api.get(`/projects/${projectId}/cameras`)
      .then((res) => {
        setCameras(res.data)
        setCameraId((current) => current || res.data[0]?.id || '')
      })
      .catch(() => setCameras([]))
  }, [projectId])

  useEffect(() => () => clearInterval(timer.current), [])

  const camera = cameras?.find((c) => c.id === cameraId)
  const device = useCameraDevice(camera)
  const webcamElsewhere = device.local && device.status && device.status.state !== 'here'

  const scan = async () => {
    setScanning(true)
    setError('')
    setResult(null)
    setElapsed(0)
    const started = Date.now()
    timer.current = setInterval(() => setElapsed((Date.now() - started) / 1000), 200)
    try {
      const res = await api.post(`/projects/${projectId}/attendance/scan`, { cameraId })
      setResult(res.data)
      if (res.data.matches?.some((m) => m.status === 'checked_in')) onDone?.()
    } catch (err) {
      setError(err.response?.data?.error || 'The scan could not run')
    } finally {
      clearInterval(timer.current)
      setScanning(false)
    }
  }

  if (cameras && cameras.length === 0) {
    return (
      <div className="attendance-scan">
        <p className="ds-muted" style={{ margin: 0 }}>Add a camera in Live monitoring to detect attendance from its feed.</p>
      </div>
    )
  }

  return (
    <div className="attendance-scan">
      {/* ▼ EDIT: title and helper text of the "Detect & mark attendance" box */}
      <div className="attendance-scan__head">
        <span className="attendance-scan__icon"><Icon name="user-check" size={20} /></span>
        <div>
          <h4 className="attendance-scan__title">Detect &amp; mark attendance</h4>
          <p className="attendance-scan__text">
            Stand in front of the camera and press the button. For {SCAN_SECONDS} seconds, enrolled workers whose
            faces are recognised are checked in (once per day).
          </p>
        </div>
      </div>

      <div className="attendance-scan__controls">
        <Select
          label="Camera"
          value={cameraId}
          onChange={(e) => { setCameraId(e.target.value); setResult(null); setError('') }}
          options={(cameras || []).map((c) => ({ value: c.id, label: c.name }))}
          disabled={scanning || !cameras}
        />
        {/* ▼ EDIT: the "Detect & mark attendance" button (text, icon, size, colour variant) */}
        <Button icon="user-check" size="lg" loading={scanning} onClick={scan} disabled={!cameraId || scanning || webcamElsewhere}>
          Detect &amp; mark attendance
        </Button>
      </div>

      {webcamElsewhere && (
        <p className="attendance-scan__warn">
          <Icon name="triangle-alert" size={16} />
          {device.status.state === 'free'
            ? `The ${deviceLabel(camera?.rtspUrl)} is not on this camera yet. In Live monitoring, press "Use ${deviceNoun(camera?.rtspUrl)} here" on it first.`
            : `The ${deviceLabel(camera?.rtspUrl)} is on ${holderLabel(device.status)}. Move it to this camera in Live monitoring first.`}
        </p>
      )}

      {scanning && (
        <div className="attendance-scan__progress" role="status">
          <span>Looking for faces… look at the camera ({Math.max(0, Math.ceil(SCAN_SECONDS - elapsed))}s)</span>
          <ProgressBar value={Math.min(1, elapsed / SCAN_SECONDS)} label="Scan progress" />
        </div>
      )}

      {error && <p className="ds-field__error" role="alert"><Icon name="circle-alert" size={14} /> {error}</p>}

      {result && (
        <div className="attendance-scan__result" role="status">
          {result.enrolledWorkers === 0 ? (
            <p>No workers with a saved face in this project yet. Enroll a worker below first.</p>
          ) : result.matches.length > 0 ? (
            <ul>
              {result.matches.map((m) => (
                <li key={m.workerId}>
                  <strong>{m.name}</strong>
                  <Badge variant={STATUS_TEXT[m.status]?.variant || 'neutral'} dot>{STATUS_TEXT[m.status]?.label || m.status}</Badge>
                  <span className="ds-caption">match {m.confidence.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {result.facesSeen === 0
                ? `No face was seen in ${result.framesChecked} frame(s). Face the camera in good light and try again.`
                : `A face was seen but didn't match an enrolled worker (closest match ${result.closestUnmatched?.toFixed(2) ?? '—'}, needs ${result.threshold.toFixed(2)}).`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
