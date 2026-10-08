import { useEffect, useState, useContext } from 'react'
import { AuthProvider, AuthContext } from './context/AuthContext'
import api from './api/axios'
import { Badge, Button, Row } from './components/ui'
import RegisterPage from './pages/RegisterPage'
import LoginPage from './pages/LoginPage'
import ProjectListPage from './pages/ProjectListPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import NewProjectPage from './pages/NewProjectPage'
import BillingPage from './pages/BillingPage'
import UsersPage from './pages/UsersPage'
import ComponentGallery from './pages/ComponentGallery'
import './App.css'

function AppContent() {
  const { user, logout } = useContext(AuthContext)
  const [apiStatus, setApiStatus] = useState('checking')
  const [view, setView] = useState('list') // list | create | detail | billing | users | gallery
  const [selectedProjectId, setSelectedProjectId] = useState(null)

  useEffect(() => {
    api.get('/health')
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('disconnected'))
  }, [])

  // Views swap in place (no router), so the browser keeps the previous view's
  // scroll offset. Start each newly shown view from the top instead.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, selectedProjectId])

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

      {/* ▼ EDIT: top bar content (logo, API status, nav buttons, log out). Styles: App.css ".app-header" */}
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
              {/* ▼ EDIT: right side of the top bar: user email/role and the nav buttons (Users, Billing, Components, Log out) */}
              <span className="app-header__user">
                {user.email} <Badge variant="info">{user.role}</Badge>
              </span>
              {user.role === 'ADMIN' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView(view === 'users' ? 'list' : 'users')}
                >
                  {view === 'users' ? 'Projects' : 'Users'}
                </Button>
              )}
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

      {/* ▼ EDIT: which page shows for each view (list / create / detail / billing / users / gallery) */}
      <main id="main" className="app-main">
        {user ? (
          <>
            {view === 'list' && (
              <ProjectListPage onSelectProject={handleSelectProject} onCreateProject={() => setView('create')} />
            )}
            {view === 'create' && (
              <NewProjectPage
                onCancel={handleBackToList}
                onCreated={(project) => handleSelectProject(project.id)}
                onOpenBilling={() => setView('billing')}
              />
            )}
            {view === 'detail' && (
              <ProjectDetailPage projectId={selectedProjectId} onBack={handleBackToList} />
            )}
            {view === 'billing' && <BillingPage />}
            {view === 'users' && <UsersPage />}
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
