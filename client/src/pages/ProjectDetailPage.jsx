import { useEffect, useState, useContext } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import { Badge, Button, Card, statusVariant } from '../components/ui'
import ChatPanel from '../components/ChatPanel'
import SafetyAlertsPanel from '../components/SafetyAlertsPanel'
import SiteUpdatesPanel from '../components/SiteUpdatesPanel'
import MaterialsPanel from '../components/MaterialsPanel'
import LiveMonitoringPage from './LiveMonitoringPage'
import LiveMonitoring from './LiveMonitoring'
import AttendancePage from './AttendancePage'
import AnalyticsDashboard from './AnalyticsDashboard'
import ReportsPage from './ReportsPage'

export default function ProjectDetailPage({ projectId, onBack }) {
  const { token } = useContext(AuthContext)
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
        </div>
        <Badge variant={statusVariant(project.status)} dot>{project.status.replace('_', ' ')}</Badge>
      </div>

      <AnalyticsDashboard projectId={projectId} />
      <LiveMonitoringPage projectId={projectId} />
      <LiveMonitoring projectId={projectId} />
      <SafetyAlertsPanel projectId={projectId} />
      <SiteUpdatesPanel projectId={projectId} />
      <MaterialsPanel projectId={projectId} />
      <AttendancePage projectId={projectId} />
      <ChatPanel projectId={projectId} token={token} />
      <ReportsPage projectId={projectId} />
    </div>
  )
}
