import { useEffect, useState, useContext } from 'react'
import { AuthProvider, AuthContext } from './context/AuthContext'
import api from './api/axios'
import { Badge, Button, Row } from './components/ui'
import RegisterPage from './pages/RegisterPage'
import LoginPage from './pages/LoginPage'
import ProjectListPage from './pages/ProjectListPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import BillingPage from './pages/BillingPage'
import ComponentGallery from './pages/ComponentGallery'
import './App.css'

function AppContent() {
  const { user, logout } = useContext(AuthContext)
  const [apiStatus, setApiStatus] = useState('checking')
  const [view, setView] = useState('list') // list | detail | billing | gallery
  const [selectedProjectId, setSelectedProjectId] = useState(null)

  useEffect(() => {
    api.get('/health')
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('disconnected'))
  }, [])

  const handleSelectProject = (projectId) => {
    setSelectedProjectId(projectId)
    setView('detail')
  }

  const handleBackToList = () => {
    setSelectedProjectId(null)
    setView('list')
  }

  const handleLogout = async () => {
    await logout()
    setView('list')
    setSelectedProjectId(null)
  }

  return (
    <>
      <a className="ds-skip-link" href="#main">Skip to main content</a>

      <header className="app-header">
        <div className="app-header__inner">
          <Row>
            <span className="app-header__brand">BuildSite&nbsp;360</span>
            <Badge variant={apiStatus === 'connected' ? 'success' : 'danger'} dot>
              {apiStatus === 'connected' ? 'API connected' : apiStatus === 'checking' ? 'Checking…' : 'API disconnected'}
            </Badge>
          </Row>

          {user && (
            <Row>
              <span className="app-header__user">
                {user.email} <Badge variant="info">{user.role}</Badge>
              </span>
              {user.role === 'ADMIN' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView(view === 'billing' ? 'list' : 'billing')}
                >
                  {view === 'billing' ? 'Projects' : 'Billing'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView(view === 'gallery' ? 'list' : 'gallery')}
              >
                {view === 'gallery' ? 'Projects' : 'Components'}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleLogout}>Log out</Button>
            </Row>
          )}
        </div>
      </header>

      <main id="main" className="app-main">
        {user ? (
          <>
            {view === 'list' && <ProjectListPage onSelectProject={handleSelectProject} />}
            {view === 'detail' && (
              <ProjectDetailPage projectId={selectedProjectId} onBack={handleBackToList} />
            )}
            {view === 'billing' && <BillingPage />}
            {view === 'gallery' && <ComponentGallery onBack={() => setView('list')} />}
          </>
        ) : (
          <div className="app-auth">
            <div className="app-auth__intro">
              <h1>BuildSite 360</h1>
              <p className="ds-muted">
                Site monitoring with real-time safety detection, material tracking, and attendance.
              </p>
            </div>
            <div className="app-auth__forms">
              <LoginPage />
              <RegisterPage />
            </div>
          </div>
        )}
      </main>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
