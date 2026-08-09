import { useEffect, useState, useContext } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, statusVariant } from '../components/ui'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

export default function LiveMonitoringPage({ projectId }) {
  const { token } = useContext(AuthContext)
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clips, setClips] = useState({})
  const [recording, setRecording] = useState({})
  const [failedStreams, setFailedStreams] = useState({})

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
                  {streamFailed ? (
                    <p className="camera-tile__placeholder">
                      Stream unavailable — the camera is unreachable.
                    </p>
                  ) : (
                    /*
                     * <img> cannot send an Authorization header, so the token is
                     * passed as a query param. See authenticateTokenAllowQuery
                     * server-side for why that is scoped to this one route.
                     */
                    <img
                      src={`${API_BASE}/cameras/${cam.id}/stream?token=${encodeURIComponent(token || '')}`}
                      alt={`Live view from ${cam.name} in the ${cam.zone.replace('_', ' ').toLowerCase()}`}
                      onError={() => setFailedStreams((prev) => ({ ...prev, [cam.id]: true }))}
                    />
                  )}
                </div>

                <div className="ds-row" style={{ marginTop: 'var(--space-sm)' }}>
                  <Button size="sm" variant="secondary" onClick={() => recordClip(cam.id)} disabled={recording[cam.id]}>
                    {recording[cam.id] ? 'Recording 30s…' : 'Record 30s clip'}
                  </Button>
                  {clip?.url && (
                    <a href={clip.url} target="_blank" rel="noreferrer">Download clip</a>
                  )}
                  {clip?.error && <span className="ds-field__error">{clip.error}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
