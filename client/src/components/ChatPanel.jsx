import { useEffect, useRef, useState, useContext } from 'react'
import api from '../api/axios'
import socket, { connectSocket } from '../api/socket'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Input, Modal, Table, statusVariant } from './ui'

export default function ChatPanel({ projectId, token }) {
  const { user } = useContext(AuthContext)
  const canAttach = user?.role === 'ADMIN' || user?.role === 'ENGINEER'
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [mediaAssets, setMediaAssets] = useState([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [attachedMedia, setAttachedMedia] = useState(null)

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get(`/projects/${projectId}/chat/history`)
        setMessages(res.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load chat history')
      } finally {
        setLoading(false)
      }
    }
    if (projectId) fetchHistory()
  }, [projectId])

  useEffect(() => {
    if (!token || !projectId) return

    const s = connectSocket(token)
    const handleMessage = (message) => setMessages((prev) => [...prev, message])
    const handleError = (err) => setError(err?.message || 'Socket error')

    s.emit('project:join', { projectId })
    s.on('chat:message', handleMessage)
    s.on('error', handleError)

    return () => {
      s.off('chat:message', handleMessage)
      s.off('error', handleError)
    }
  }, [projectId, token])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages])

  const handleSend = (e) => {
    e.preventDefault()
    if (!content.trim() && !attachedMedia) return
    socket.emit('chat:send', { projectId, content: content.trim(), mediaAssetId: attachedMedia?.id })
    setContent('')
    setAttachedMedia(null)
  }

  const openPicker = async () => {
    setPickerOpen(true)
    setMediaError('')
    setMediaLoading(true)
    try {
      const res = await api.get(`/projects/${projectId}/media`)
      setMediaAssets(res.data)
    } catch (err) {
      setMediaError(err.response?.data?.error || 'Failed to load media library')
    } finally {
      setMediaLoading(false)
    }
  }

  const handlePick = (asset) => {
    setAttachedMedia(asset)
    setPickerOpen(false)
  }

  const pickerColumns = [
    {
      key: 'preview',
      header: '',
      render: (a) =>
        a.type === 'IMAGE' ? (
          <img src={a.url} alt={a.caption || 'media'} style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 4 }} />
        ) : (
          <video src={a.url} style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 4 }} muted />
        ),
    },
    { key: 'caption', header: 'Caption', render: (a) => a.caption || <span className="ds-muted">—</span> },
    { key: 'type', header: 'Type' },
  ]

  return (
    <Card title="Project chat" subtitle="Messages are shared with everyone on this project">
      {loading && <p className="ds-muted">Loading chat…</p>}
      {error && <p className="ds-field__error" role="alert">{error}</p>}

      {!loading && (
        <>
          {/* aria-live so newly arriving messages are announced to screen readers
              without the user needing to poll the region manually. */}
          <div className="chat-log" role="log" aria-live="polite" aria-label="Chat messages">
            {messages.length === 0 && <p className="ds-muted">No messages yet. Say something.</p>}
            {messages.map((m) => {
              const isOwn = m.senderId === user?.id
              return (
                <div key={m.id} className={`chat-message ${isOwn ? 'chat-message--own' : ''}`}>
                  <div className="chat-message__meta">
                    <Badge variant={statusVariant(m.sender?.role)}>{m.sender?.role}</Badge>
                    <span>{m.sender?.name}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString()}</time>
                  </div>
                  {m.content && <div className="chat-message__body">{m.content}</div>}
                  {m.fileUrl && m.mediaAsset?.type === 'IMAGE' && (
                    <a href={m.fileUrl} target="_blank" rel="noreferrer">
                      <img src={m.fileUrl} alt={m.mediaAsset.caption || 'Shared image'} style={{ maxWidth: 220, borderRadius: 'var(--radius-sm, 6px)', display: 'block' }} />
                    </a>
                  )}
                  {m.fileUrl && m.mediaAsset?.type === 'VIDEO' && (
                    <video src={m.fileUrl} controls style={{ maxWidth: 260, borderRadius: 'var(--radius-sm, 6px)', display: 'block' }} />
                  )}
                  {m.fileUrl && !m.mediaAsset && (
                    <a href={m.fileUrl} target="_blank" rel="noreferrer">Attachment</a>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {attachedMedia && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-xs)' }}>
              {attachedMedia.type === 'IMAGE' ? (
                <img src={attachedMedia.url} alt={attachedMedia.caption || 'media'} style={{ width: 40, height: 30, objectFit: 'cover', borderRadius: 4 }} />
              ) : (
                <video src={attachedMedia.url} style={{ width: 40, height: 30, objectFit: 'cover', borderRadius: 4 }} muted />
              )}
              <span className="ds-caption">{attachedMedia.caption || 'Attached media'}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAttachedMedia(null)}>
                Remove
              </Button>
            </div>
          )}

          <form className="chat-form" onSubmit={handleSend}>
            <Input
              label="Message"
              placeholder="Type a message"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {canAttach && (
              <Button type="button" variant="secondary" onClick={openPicker} style={{ marginTop: 26 }}>
                Attach media
              </Button>
            )}
            <Button type="submit" disabled={!content.trim() && !attachedMedia} style={{ marginTop: 26 }}>
              Send
            </Button>
          </form>
        </>
      )}

      <Modal
        open={pickerOpen}
        title="Attach media from library"
        onClose={() => setPickerOpen(false)}
        footer={
          <Button variant="secondary" onClick={() => setPickerOpen(false)}>
            Cancel
          </Button>
        }
      >
        {mediaLoading && <p className="ds-muted">Loading…</p>}
        {!mediaLoading && mediaError && <p className="ds-field__error" role="alert">{mediaError}</p>}
        {!mediaLoading && !mediaError && (
          <Table
            columns={pickerColumns}
            rows={mediaAssets}
            empty="No media in the library yet - upload some from the Media tab first."
            onRowClick={handlePick}
          />
        )}
      </Modal>
    </Card>
  )
}
