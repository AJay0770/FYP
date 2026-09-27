import { useCallback, useEffect, useRef, useState, useContext } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Input, Modal, statusVariant } from '../components/ui'
import useCameraDevice, { holderLabel } from '../components/useCameraDevice'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

// OpenCV device index of the machine running the AI service - "0" is the
// laptop's built-in webcam. See utils/cameraSource.js server-side.
const LAPTOP_WEBCAM_SOURCE = '0'

/**
 * An MJPEG <img> that closes its connection on unmount. Chrome keeps loading
 * a multipart image after the element is removed, so leaving a project would
 * otherwise leave its stream open - and a local webcam can only be held by
 * one stream at a time.
 */
function MjpegStream(props) {
  const imgRef = useRef(null)
  // A ref callback rather than an effect cleanup: StrictMode runs effects
  // mount -> cleanup -> mount in development, and blanking src in that fake
  // cleanup fires onError, marking the stream failed before it ever loads.
  // Ref callbacks are not double-invoked, so this runs only on real unmount
  // (stable identity via useCallback, or React would re-run it every render).
  const setRef = useCallback((el) => {
    if (el) {
      imgRef.current = el
      return
    }
    if (imgRef.current) imgRef.current.src = ''
    imgRef.current = null
  }, [])
  return <img ref={setRef} {...props} />
}

function CameraTile({ cam, projectId, token, canEditSource, onCameraUpdated }) {
  const device = useCameraDevice(cam)
  const [clip, setClip] = useState(null)
  const [recording, setRecording] = useState(false)
  const [streamFailed, setStreamFailed] = useState(false)
  // Network cameras only: pausing just this viewer. A webcam is freed with
  // "Release webcam" instead, which is what makes it available elsewhere.
  const [streamStopped, setStreamStopped] = useState(false)
  const [edit, setEdit] = useState(null) // { value, saving, error } while editing the source
  const [confirmMove, setConfirmMove] = useState(false)

  const zoneLabel = cam.zone.replace('_', ' ')
  const deviceState = device.status?.state
  const canControl = Boolean(device.status?.canControl)
  // A webcam camera streams only while the webcam is assigned to it.
  const showStream = device.local ? deviceState === 'here' && !streamFailed : !streamStopped && !streamFailed

  // A fresh assignment deserves a fresh attempt at the stream.
  useEffect(() => {
    if (deviceState === 'here') setStreamFailed(false)
  }, [deviceState])

  const recordClip = async () => {
    setRecording(true)
    setClip(null)
    try {
      const res = await api.post(`/cameras/${cam.id}/record-clip`)
      setClip({ url: res.data.clipUrl })
    } catch (err) {
      setClip({ error: err.response?.data?.error || 'Recording failed' })
    } finally {
      setRecording(false)
    }
  }

  const saveSource = async (value) => {
    setEdit((prev) => ({ ...prev, value, saving: true, error: '' }))
    try {
      const res = await api.patch(`/projects/${projectId}/cameras/${cam.id}`, { rtspUrl: value })
      setStreamFailed(false)
      setEdit(null)
      onCameraUpdated(res.data)
    } catch (err) {
      setEdit((prev) => ({ ...prev, saving: false, error: err.response?.data?.error || 'Failed to update source' }))
    }
  }

  const changeDevice = async (action) => {
    const ok = action === 'release' ? await device.release() : await device.assign(action === 'move')
    if (ok) onCameraUpdated(cam, { deviceChanged: true })
  }

  let placeholder = null
  if (device.local) {
    if (!device.status) {
      placeholder = device.error ? `Webcam status unavailable — ${device.error}` : 'Checking the webcam…'
    } else if (deviceState === 'free') {
      placeholder = 'The laptop webcam is free. Choose "Use webcam here" to show it on this camera.'
    } else if (deviceState === 'elsewhere') {
      placeholder = `The laptop webcam is in use by ${holderLabel(device.status)}.`
    } else if (streamFailed) {
      placeholder = 'Stream unavailable — the webcam could not be opened.'
    }
  } else if (streamStopped) {
    placeholder = 'Feed paused.'
  } else if (streamFailed) {
    placeholder = 'Stream unavailable — the camera is unreachable.'
  }

  return (
    <div>
      <div className="ds-row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
        <div>
          <strong>{cam.name}</strong>
          <div className="ds-caption">
            {zoneLabel}
            {device.local && ' · laptop webcam'}
          </div>
        </div>
        {device.local && deviceState ? (
          <Badge variant={deviceState === 'here' ? 'success' : deviceState === 'free' ? 'neutral' : 'warning'} dot>
            {deviceState === 'here' ? 'Webcam in use here' : deviceState === 'free' ? 'Webcam free' : 'Webcam elsewhere'}
          </Badge>
        ) : (
          <Badge variant={statusVariant(cam.status)} dot>{cam.status}</Badge>
        )}
      </div>

      <div className="camera-tile__frame">
        {showStream ? (
          /*
           * <img> cannot send an Authorization header, so the token is
           * passed as a query param. See authenticateTokenAllowQuery
           * server-side for why that is scoped to this one route.
           */
          <MjpegStream
            // Keyed on the source so re-pointing the camera opens a
            // fresh MJPEG connection instead of keeping the old one.
            key={cam.rtspUrl}
            src={`${API_BASE}/cameras/${cam.id}/stream?token=${encodeURIComponent(token || '')}`}
            alt={`Live view from ${cam.name} in the ${zoneLabel.toLowerCase()}`}
            onError={() => setStreamFailed(true)}
          />
        ) : (
          <p className="camera-tile__placeholder">{placeholder}</p>
        )}
      </div>

      <div className="ds-row" style={{ marginTop: 'var(--space-sm)' }}>
        {device.local ? (
          canControl && (
            <>
              {deviceState === 'free' && (
                <Button size="sm" onClick={() => changeDevice('assign')} disabled={device.busy}>
                  Use webcam here
                </Button>
              )}
              {deviceState === 'elsewhere' && (
                <Button size="sm" onClick={() => setConfirmMove(true)} disabled={device.busy}>
                  Move webcam here
                </Button>
              )}
              {deviceState === 'here' && streamFailed && (
                <Button size="sm" onClick={() => setStreamFailed(false)}>Retry</Button>
              )}
              {deviceState === 'here' && (
                <Button size="sm" variant="secondary" onClick={() => changeDevice('release')} disabled={device.busy}>
                  Release webcam
                </Button>
              )}
            </>
          )
        ) : streamStopped || streamFailed ? (
          <Button
            size="sm"
            onClick={() => {
              setStreamStopped(false)
              setStreamFailed(false)
            }}
          >
            Start feed
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setStreamStopped(true)}>Stop feed</Button>
        )}

        {(!device.local || deviceState === 'here') && (
          <Button size="sm" variant="secondary" onClick={recordClip} disabled={recording}>
            {recording ? 'Recording 30s…' : 'Record 30s clip'}
          </Button>
        )}
        {clip?.url && (
          <a href={clip.url} target="_blank" rel="noreferrer">Download clip</a>
        )}
        {clip?.error && <span className="ds-field__error">{clip.error}</span>}
        {canEditSource && !edit && (
          <Button size="sm" variant="ghost" onClick={() => setEdit({ value: cam.rtspUrl, error: '' })}>
            Change source
          </Button>
        )}
      </div>

      {device.local && device.status && !canControl && (
        <p className="ds-caption" style={{ marginTop: 'var(--space-xs)' }}>
          Only an admin or an engineer on this project can move the webcam.
        </p>
      )}
      {device.local && device.error && device.status && (
        <p className="ds-field__error" role="alert">{device.error}</p>
      )}

      {canEditSource && edit && (
        <form
          style={{ marginTop: 'var(--space-sm)' }}
          onSubmit={(e) => {
            e.preventDefault()
            saveSource(edit.value.trim())
          }}
        >
          <Input
            label={`Source for ${cam.name}`}
            value={edit.value}
            onChange={(e) => setEdit((prev) => ({ ...prev, value: e.target.value }))}
            hint="Paste 0 for the laptop webcam, or an rtsp:// / http:// camera URL."
            error={edit.error}
            disabled={edit.saving}
          />
          <div className="ds-row">
            <Button size="sm" type="submit" disabled={edit.saving || !edit.value.trim()}>
              {edit.saving ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="secondary" disabled={edit.saving} onClick={() => saveSource(LAPTOP_WEBCAM_SOURCE)}>
              Use laptop webcam
            </Button>
            <Button size="sm" variant="ghost" disabled={edit.saving} onClick={() => setEdit(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <Modal
        open={confirmMove}
        title="Move the webcam?"
        onClose={() => setConfirmMove(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmMove(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                setConfirmMove(false)
                await changeDevice('move')
              }}
            >
              Move webcam here
            </Button>
          </>
        }
      >
        <p>
          The laptop webcam is currently used by <strong>{holderLabel(device.status)}</strong>. Moving it
          here stops that feed and its safety detection.
        </p>
      </Modal>
    </div>
  )
}

export default function LiveMonitoringPage({ projectId, onCameraUpdated }) {
  const { token, user } = useContext(AuthContext)
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Mirrors the server: only ADMIN or an engineer (assignment is enforced there)
  // may re-point a camera.
  const canEditSource = user?.role === 'ADMIN' || user?.role === 'ENGINEER'

  useEffect(() => {
    const fetchCameras = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get(`/projects/${projectId}/cameras`)
        setCameras(res.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load cameras')
      } finally {
        setLoading(false)
      }
    }
    if (projectId) fetchCameras()
  }, [projectId])

  const handleCameraUpdated = (updated, change = {}) => {
    if (!change.deviceChanged) {
      setCameras((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    }
    onCameraUpdated?.(updated)
  }

  return (
    <Card
      title="Live monitoring"
      subtitle={cameras.length ? `${cameras.length} camera(s)` : undefined}
    >
      {loading && <p className="ds-muted">Loading cameras…</p>}
      {!loading && error && <p className="ds-field__error" role="alert">{error}</p>}
      {!loading && !error && cameras.length === 0 && (
        <p className="ds-muted">No cameras registered for this project.</p>
      )}

      {!loading && cameras.length > 0 && (
        <div className="camera-grid">
          {cameras.map((cam) => (
            <CameraTile
              key={cam.id}
              cam={cam}
              projectId={projectId}
              token={token}
              canEditSource={canEditSource}
              onCameraUpdated={handleCameraUpdated}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
