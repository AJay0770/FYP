import { useContext, useEffect, useRef, useState } from 'react'
import api from '../api/axios'
import socket, { connectSocket } from '../api/socket'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Input, Modal, Table, ToastRegion, useToasts } from '../components/ui'

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

function inferMediaType(file) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  return IMAGE_EXTENSIONS.has(ext) ? 'IMAGE' : 'VIDEO'
}

export default function MediaPanel({ projectId, token }) {
  const { user } = useContext(AuthContext)
  const canManage = user?.role === 'ADMIN' || user?.role === 'ENGINEER'

  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { toasts, push, dismiss } = useToasts()

  const [uploadOpen, setUploadOpen] = useState(false)
  const [file, setFile] = useState(null)
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const fileInputRef = useRef(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/projects/${projectId}/media`)
      setAssets(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load media')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Reuses the same shared socket ChatPanel connects - joining a room a
  // socket already joined is a harmless no-op, and this keeps "share to
  // chat" working even if MediaPanel somehow renders before ChatPanel does.
  useEffect(() => {
    if (!token || !projectId) return
    const s = connectSocket(token)
    s.emit('project:join', { projectId })
  }, [token, projectId])

  const openUploadForm = () => {
    setFile(null)
    setCaption('')
    setUploadError('')
    setUploadOpen(true)
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!file) {
      setUploadError('Choose a file first')
      return
    }

    setUploading(true)
    setUploadError('')
    try {
      const { data: presign } = await api.post(`/projects/${projectId}/media/presign`, {
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
      })

      // Presigned URLs are pre-authenticated for exactly this upload - hit
      // them directly with fetch, not the shared `api` instance, so the
      // bearer token/interceptors meant for our own API never get attached
      // to a request going to S3 instead.
      const putResponse = await fetch(presign.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putResponse.ok) {
        throw new Error(`Upload to storage failed (${putResponse.status})`)
      }

      await api.post(`/projects/${projectId}/media`, {
        url: presign.publicUrl,
        type: inferMediaType(file),
        caption: caption || undefined,
      })

      push({ variant: 'success', title: 'Media uploaded' })
      setUploadOpen(false)
      await load()
    } catch (err) {
      setUploadError(err.response?.data?.error || err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleShare = (asset) => {
    socket.emit('chat:send', { projectId, mediaAssetId: asset.id })
    push({ variant: 'success', title: 'Shared to project chat' })
  }

  const handleDelete = async (asset) => {
    if (!window.confirm(`Delete ${asset.caption ? `"${asset.caption}"` : 'this media item'}? This cannot be undone.`)) return

    setDeletingId(asset.id)
    try {
      await api.delete(`/projects/${projectId}/media/${asset.id}`)
      push({ variant: 'success', title: 'Media deleted' })
      await load()
    } catch (err) {
      push({ variant: 'danger', title: err.response?.data?.error || 'Failed to delete media' })
    } finally {
      setDeletingId(null)
    }
  }

  const columns = [
    {
      key: 'preview',
      header: '',
      render: (a) =>
        a.type === 'IMAGE' ? (
          <img src={a.url} alt={a.caption || 'media'} style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 4 }} />
        ) : (
          <video src={a.url} style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 4 }} muted />
        ),
    },
    { key: 'caption', header: 'Caption', render: (a) => a.caption || <span className="ds-muted">—</span> },
    {
      key: 'source',
      header: 'Source',
      render: (a) => <Badge variant={a.source === 'CLIP_RECORDING' ? 'info' : 'neutral'}>{a.source === 'CLIP_RECORDING' ? 'Camera clip' : 'Upload'}</Badge>,
    },
    { key: 'camera', header: 'Camera', render: (a) => a.camera?.name || <span className="ds-muted">—</span> },
    { key: 'uploadedBy', header: 'By', render: (a) => a.uploadedBy?.name || '—' },
    { key: 'createdAt', header: 'When', render: (a) => new Date(a.createdAt).toLocaleString() },
    {
      key: 'actions',
      header: '',
      render: (a) => (
        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
          <Button size="sm" variant="ghost" onClick={() => window.open(a.url, '_blank', 'noopener')}>
            Open
          </Button>
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => handleShare(a)}>
              Share to chat
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              disabled={deletingId === a.id}
              onClick={() => handleDelete(a)}
            >
              {deletingId === a.id ? 'Deleting…' : 'Delete'}
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <Card
      title="Media"
      subtitle="Recorded clips and shared images/videos for this project"
      actions={
        canManage && (
          <Button size="sm" onClick={openUploadForm}>
            Upload media
          </Button>
        )
      }
    >
      <ToastRegion toasts={toasts} onDismiss={dismiss} />

      {loading && <p className="ds-muted">Loading…</p>}
      {!loading && error && <p className="ds-field__error" role="alert">{error}</p>}
      {!loading && !error && <Table columns={columns} rows={assets} empty="No media yet" hover={false} />}

      <Modal
        open={uploadOpen}
        title="Upload media"
        onClose={() => setUploadOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleUpload} noValidate>
          {uploadError && <p className="ds-field__error" role="alert">{uploadError}</p>}
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="media-file">File</label>
            <input
              id="media-file"
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/quicktime"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
          <Input
            label="Caption (optional)"
            placeholder="Foundation pour, north wall"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </form>
      </Modal>
    </Card>
  )
}
