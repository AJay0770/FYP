import { useCallback, useEffect, useRef, useState, useContext } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Input, statusVariant } from '../components/ui'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

// OpenCV device index of the machine running the AI service - "0" is the
// laptop's built-in webcam. See utils/cameraSource.js server-side.
const LAPTOP_WEBCAM_SOURCE = '0'

/**
 * An MJPEG <img> that closes its connection on unmount. Chrome keeps loading
 * a multipart image after the element is removed, so leaving a project would
 * otherwise leave its stream open - and a local webcam can only be held by
 * one stream, so the next project's camera could not open it.
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

export default function LiveMonitoringPage({ projectId, onCameraUpdated }) {
  const { token, user } = useContext(AuthContext)
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clips, setClips] = useState({})
  const [recording, setRecording] = useState({})
  const [failedStreams, setFailedStreams] = useState({})
  // Viewer-stopped feeds, so a shared device like the laptop webcam can be
  // released for a camera in another project.
  const [stoppedStreams, setStoppedStreams] = useState({})

  const stopStream = (cameraId) => setStoppedStreams((prev) => ({ ...prev, [cameraId]: true }))
  const startStream = (cameraId) => {
    setStoppedStreams((prev) => ({ ...prev, [cameraId]: false }))
    setFailedStreams((prev) => ({ ...prev, [cameraId]: false }))
  }
  // cameraId -> { value, saving, error } while that camera's source is being edited
  const [sourceEdits, setSourceEdits] = useState({})

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

  const recordClip = async (cameraId) => {
    setRecording((prev) => ({ ...prev, [cameraId]: true }))
    setClips((prev) => ({ ...prev, [cameraId]: null }))
    try {
      const res = await api.post(`/cameras/${cameraId}/record-clip`)
      setClips((prev) => ({ ...prev, [cameraId]: { url: res.data.clipUrl } }))
    } catch (err) {
      setClips((prev) => ({
        ...prev,
        [cameraId]: { error: err.response?.data?.error || 'Recording failed' },
      }))
    } finally {
      setRecording((prev) => ({ ...prev, [cameraId]: false }))
    }
  }

  const updateSourceEdit = (cameraId, patch) =>
    setSourceEdits((prev) => ({ ...prev, [cameraId]: { ...prev[cameraId], ...patch } }))

  const closeSourceEdit = (cameraId) =>
    setSourceEdits((prev) => {
      const next = { ...prev }
      delete next[cameraId]
      return next
    })

  const saveSource = async (cameraId, value) => {
    updateSourceEdit(cameraId, { value, saving: true, error: '' })
    try {
      const res = await api.patch(`/projects/${projectId}/cameras/${cameraId}`, { rtspUrl: value })
      setCameras((prev) => prev.map((c) => (c.id === cameraId ? res.data : c)))
      setFailedStreams((prev) => ({ ...prev, [cameraId]: false }))
      closeSourceEdit(cameraId)
      onCameraUpdated?.(res.data)
    } catch (err) {
      updateSourceEdit(cameraId, { saving: false, error: err.response?.data?.error || 'Failed to update source' })
    }
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
          {cameras.map((cam) => {
            const clip = clips[cam.id]
            const streamFailed = failedStreams[cam.id]
            const streamStopped = stoppedStreams[cam.id]
            const edit = sourceEdits[cam.id]
            return (
              <div key={cam.id}>
                <div className="ds-row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                  <div>
                    <strong>{cam.name}</strong>
                    <div className="ds-caption">{cam.zone.replace('_', ' ')}</div>
                  </div>
                  <Badge variant={statusVariant(cam.status)} dot>{cam.status}</Badge>
                </div>

                <div className="camera-tile__frame">
                  {streamStopped ? (
                    <p className="camera-tile__placeholder">
                      Feed stopped — the camera is free for another project.
                    </p>
                  ) : streamFailed ? (
                    <p className="camera-tile__placeholder">
                      Stream unavailable — the camera is unreachable.
                    </p>
                  ) : (
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
                      alt={`Live view from ${cam.name} in the ${cam.zone.replace('_', ' ').toLowerCase()}`}
                      onError={() => setFailedStreams((prev) => ({ ...prev, [cam.id]: true }))}
                    />
                  )}
                </div>

                <div className="ds-row" style={{ marginTop: 'var(--space-sm)' }}>
                  {/*
                    * Stopping unmounts the stream, which closes its connection;
                    * the server then ends that ffmpeg and releases the device.
                    * Start also serves as a retry after a failed stream.
                    */}
                  {streamStopped || streamFailed ? (
                    <Button size="sm" onClick={() => startStream(cam.id)}>Start feed</Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => stopStream(cam.id)}>Stop feed</Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => recordClip(cam.id)} disabled={recording[cam.id]}>
                    {recording[cam.id] ? 'Recording 30s…' : 'Record 30s clip'}
                  </Button>
                  {clip?.url && (
                    <a href={clip.url} target="_blank" rel="noreferrer">Download clip</a>
                  )}
                  {clip?.error && <span className="ds-field__error">{clip.error}</span>}
                  {canEditSource && !edit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateSourceEdit(cam.id, { value: cam.rtspUrl, error: '' })}
                    >
                      Change source
                    </Button>
                  )}
                </div>

                {canEditSource && edit && (
                  <form
                    style={{ marginTop: 'var(--space-sm)' }}
                    onSubmit={(e) => {
                      e.preventDefault()
                      saveSource(cam.id, edit.value.trim())
                    }}
                  >
                    <Input
                      label={`Source for ${cam.name}`}
                      value={edit.value}
                      onChange={(e) => updateSourceEdit(cam.id, { value: e.target.value })}
                      hint="Paste 0 for the laptop webcam, or an rtsp:// / http:// camera URL."
                      error={edit.error}
                      disabled={edit.saving}
                    />
                    <div className="ds-row">
                      <Button size="sm" type="submit" disabled={edit.saving || !edit.value.trim()}>
                        {edit.saving ? 'Saving…' : 'Save'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={edit.saving}
                        onClick={() => saveSource(cam.id, LAPTOP_WEBCAM_SOURCE)}
                      >
                        Use laptop webcam
                      </Button>
                      <Button size="sm" variant="ghost" disabled={edit.saving} onClick={() => closeSourceEdit(cam.id)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
