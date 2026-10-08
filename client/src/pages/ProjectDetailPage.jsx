import { useEffect, useState, useContext } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Button, Card, Row } from '../components/ui'
import ChatPanel from '../components/ChatPanel'
import SafetyAlertsPanel from '../components/SafetyAlertsPanel'
import SiteUpdatesPanel from '../components/SiteUpdatesPanel'
import MaterialsPanel from '../components/MaterialsPanel'
import MediaPanel from '../components/MediaPanel'
import LiveMonitoringPage from './LiveMonitoringPage'
import LiveMonitoring from './LiveMonitoring'
import AttendancePage from './AttendancePage'
import AnalyticsDashboard from './AnalyticsDashboard'
import ReportsPage from './ReportsPage'
import ProjectStatusControl from '../components/ProjectStatusControl'
import ProjectEngineers from '../components/ProjectEngineers'
import ProjectActions from '../components/ProjectActions'

export default function ProjectDetailPage({ projectId, onBack, onDeleted }) {
  const { token } = useContext(AuthContext)
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview') // overview | media
  // Bumped when a camera's source changes, to remount LiveMonitoring: it keeps
  // its own camera list and an open MJPEG connection to the old source.
  const [camerasVersion, setCamerasVersion] = useState(0)

  useEffect(() => {
    const fetchProject = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get(`/projects/${projectId}`)
        setProject(res.data)
      } catch (err) {
        setError(
          err.response?.status === 404
            ? 'Project not found, or you do not have access to it.'
            : err.response?.data?.error || 'Failed to load project'
        )
      } finally {
        setLoading(false)
      }
    }
    if (projectId) fetchProject()
  }, [projectId])

  if (loading) return <p className="ds-muted">Loading project…</p>

  if (error) {
    return (
      <Card>
        <p className="ds-field__error" role="alert">{error}</p>
        <Button variant="secondary" onClick={onBack}>Back to projects</Button>
      </Card>
    )
  }

  if (!project) return null

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack}>&larr; All projects</Button>

      {/* ▼ EDIT: project title area (name, address, client, dates, engineers, status). Styles: App.css "Project detail" */}
      <div className="project-header">
        <div>
          <h1 style={{ marginBottom: 'var(--space-xs)' }}>{project.name}</h1>
          <div className="project-header__meta">
            <span>{project.address}</span>
            <span>Client: {project.client?.email || '—'}</span>
            <span>
              {new Date(project.startDate).toLocaleDateString()} –{' '}
              {new Date(project.expectedCompletionDate).toLocaleDateString()}
            </span>
          </div>
          <ProjectEngineers
            project={project}
            onAssigned={(row) => setProject((p) => ({ ...p, engineers: [...(p.engineers || []), row] }))}
            onRemoved={(engineerId) => setProject((p) => ({ ...p, engineers: (p.engineers || []).filter((e) => e.engineerId !== engineerId) }))}
          />
        </div>
        <div className="project-header__controls">
          <ProjectStatusControl project={project} onChange={(status) => setProject((p) => ({ ...p, status }))} />
          <ProjectActions
            project={project}
            onUpdated={(updated) => setProject((p) => ({ ...p, ...updated }))}
            onDeleted={onDeleted || onBack}
          />
        </div>
      </div>

      <Row style={{ marginBottom: 'var(--space-lg)' }}>
        <Button
          size="sm"
          variant={tab === 'overview' ? 'primary' : 'secondary'}
          onClick={() => setTab('overview')}
          aria-pressed={tab === 'overview'}
        >
          Overview
        </Button>
        <Button
          size="sm"
          variant={tab === 'media' ? 'primary' : 'secondary'}
          onClick={() => setTab('media')}
          aria-pressed={tab === 'media'}
        >
          Media
        </Button>
      </Row>

      {/* ▼ EDIT: ORDER of the panels on a project page - move these lines to reorder, delete one to hide it */}
      {tab === 'overview' && (
        <>
          <AnalyticsDashboard projectId={projectId} />
          <LiveMonitoringPage projectId={projectId} onCameraUpdated={() => setCamerasVersion((v) => v + 1)} />
          <LiveMonitoring key={camerasVersion} projectId={projectId} />
          <SafetyAlertsPanel projectId={projectId} />
          <SiteUpdatesPanel projectId={projectId} />
          <MaterialsPanel projectId={projectId} />
          <AttendancePage projectId={projectId} />
          <ChatPanel projectId={projectId} token={token} />
          <ReportsPage projectId={projectId} />
        </>
      )}

      {tab === 'media' && <MediaPanel projectId={projectId} token={token} />}
    </div>
  )
}
