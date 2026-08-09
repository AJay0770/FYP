import { useEffect, useRef, useState, useContext } from 'react'
import api from '../api/axios'
import socket, { connectSocket } from '../api/socket'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, Input, statusVariant } from './ui'

export default function ChatPanel({ projectId, token }) {
  const { user } = useContext(AuthContext)
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

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
    if (!content.trim()) return
    socket.emit('chat:send', { projectId, content })
    setContent('')
  }

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
                  <div className="chat-message__body">{m.content}</div>
                  {m.fileUrl && (
                    <a href={m.fileUrl} target="_blank" rel="noreferrer">Attachment</a>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <form className="chat-form" onSubmit={handleSend}>
            <Input
              label="Message"
              placeholder="Type a message"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <Button type="submit" disabled={!content.trim()} style={{ marginTop: 26 }}>
              Send
            </Button>
          </form>
        </>
      )}
    </Card>
  )
}
