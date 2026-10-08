import { useCallback, useContext, useEffect, useState } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, EmptyState, FileInput, Table, Textarea } from '../components/ui'

// Mirrors the server's ALLOWED_EXTENSIONS for site-update media (routes/updates.js).
const MEDIA_ACCEPT = '.jpg,.jpeg,.png,.mp4,.mov'

export default function SiteUpdatesPanel({ projectId }) {
  const { user } = useContext(AuthContext)
  const [updates, setUpdates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Posting is for the project's engineers (the server also checks they are
  // assigned to this project).
  const canPost = user?.role === 'ENGINEER'
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/projects/${projectId}/updates`)
      setUpdates(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load site updates')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectId) load()
  }, [projectId, load])

  const handlePost = async (e) => {
    e.preventDefault()
    if (!description.trim()) return
    setPosting(true)
    setPostError('')
    try {
      const mediaUrls = []
      if (file) {
        // Same presigned-upload flow as the media library: ask the API for a
        // one-off upload URL, send the file straight to storage, keep its URL.
        const { data: presign } = await api.post(`/projects/${projectId}/updates/presign`, {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          fileSize: file.size,
        })
        const put = await fetch(presign.presignedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        if (!put.ok) throw new Error('Upload failed')
        mediaUrls.push(presign.publicUrl)
      }
      await api.post(`/projects/${projectId}/updates`, { description: description.trim(), mediaUrls })
      setDescription('')
      setFile(null)
      setFileInputKey((k) => k + 1)
      await load()
    } catch (err) {
      setPostError(err.response?.data?.error || err.message || 'Could not post the update')
    } finally {
      setPosting(false)
    }
  }

  const columns = [
    { key: 'description', header: 'Update' },
    {
      key: 'engineer',
      header: 'Logged by',
      render: (row) => row.engineer?.name || '—',
    },
    {
      key: 'media',
      header: 'Media',
      render: (row) =>
        row.mediaUrls?.length ? (
          <a href={row.mediaUrls[0]} target="_blank" rel="noreferrer">
            <Badge variant="info" icon="image">{row.mediaUrls.length} {row.mediaType.toLowerCase()}</Badge>
          </a>
        ) : (
          <span className="ds-muted">none</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'When',
      render: (row) => new Date(row.createdAt).toLocaleString(),
    },
  ]

  return (
    <Card title="Site updates" subtitle="Newest first" icon="clipboard-list">
      {/* ▼ EDIT: the "Post a site update" form (styles: App.css ".site-update-form") */}
      {canPost && (
        <form onSubmit={handlePost} className="site-update-form">
          <Textarea
            label="Post a site update"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened on site today?"
            disabled={posting}
          />
          <FileInput
            key={fileInputKey}
            label="Photo or video (optional)"
            accept={MEDIA_ACCEPT}
            hint="JPG, PNG, MP4 or MOV, up to 50 MB"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={posting}
          />
          {postError && <p className="ds-field__error" role="alert">{postError}</p>}
          <Button type="submit" icon="send" loading={posting} disabled={!description.trim()}>Post update</Button>
        </form>
      )}

      {!loading && error ? (
        <p className="ds-field__error" role="alert">{error}</p>
      ) : (
        <Table
          columns={columns}
          rows={updates}
          loading={loading}
          hover={false}
          emptyState={
            <EmptyState
              compact
              icon="clipboard-list"
              title="No site updates yet"
              message={canPost ? 'Post the first update above.' : 'Updates from the site engineers will appear here.'}
            />
          }
        />
      )}
    </Card>
  )
}
