import { useCallback, useEffect, useState } from 'react'
import api from '../api/axios'

// A bare device index ("0", "1"...) is a local webcam - see
// server/src/utils/cameraSource.js, which classifies sources the same way.
export function isLocalDeviceSource(source) {
  return /^\s*\d+\s*$/.test(source || '')
}

const POLL_MS = 5000

/**
 * Who is using a local webcam camera's device: 'free', 'here' or 'elsewhere'.
 *
 * The webcam only moves when a user explicitly assigns or releases it
 * (server/src/routes/cameraDevice.js); this polls so every open page reflects
 * a change made on another page or tab. For non-webcam cameras `local` is
 * false and nothing is fetched.
 */
export default function useCameraDevice(camera) {
  const local = Boolean(camera) && isLocalDeviceSource(camera.rtspUrl)
  const cameraId = camera?.id
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!local) return
    try {
      const res = await api.get(`/cameras/${cameraId}/device`)
      setStatus(res.data)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Could not check the webcam')
    }
  }, [cameraId, local])

  useEffect(() => {
    setStatus(null)
    if (!local) return undefined
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [local, refresh])

  const act = async (action, body) => {
    setBusy(true)
    try {
      const res = await api.post(`/cameras/${cameraId}/device/${action}`, body)
      setStatus(res.data)
      setError('')
      return true
    } catch (err) {
      // A 409 carries the current state (e.g. someone else took it meanwhile).
      if (err.response?.data?.state) setStatus(err.response.data)
      setError(err.response?.data?.error || 'Could not change the webcam')
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    local,
    status,
    error,
    busy,
    refresh,
    assign: (takeover = false) => act('assign', { takeover }),
    release: () => act('release'),
  }
}

/** "West Side (Riverside Tower)", or a neutral label when the holder is hidden. */
export function holderLabel(status) {
  const h = status?.holder
  if (!h || h.restricted) return 'a camera in another project'
  return `${h.cameraName} (${h.projectName})`
}
