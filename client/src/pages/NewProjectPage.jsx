import { useContext, useEffect, useState } from 'react'
import api from '../api/axios'
import { AuthContext } from '../context/AuthContext'
import {
  Button, Card, EmptyState, Grid, Icon, Input, Modal, PageHeader, SegmentedControl, Select, Skeleton,
} from '../components/ui'
import { PASSWORD_HINT, isPasswordValid, passwordProblem } from '../utils/password'
import { sourceHint } from '../components/useCameraDevice'
import './NewProjectPage.css'

const ZONES = [
  { value: 'WORK_AREA', label: 'Work area' },
  { value: 'ENTRANCE', label: 'Entrance' },
  { value: 'STORAGE', label: 'Storage' },
]

// "0" is the laptop's built-in webcam (see server utils/cameraSource.js).
const newCamera = (n) => ({ key: `${Date.now()}-${n}`, name: '', zone: 'WORK_AREA', source: '0' })

/**
 * Create a project from scratch: details, cameras and the client (an existing
 * one, or a brand-new account with a password set here). Everything is sent
 * in one request so the server creates it all together or not at all.
 */
export default function NewProjectPage({ onCancel, onCreated, onOpenBilling }) {
  const { user } = useContext(AuthContext)
  const today = new Date().toISOString().slice(0, 10)

  const [details, setDetails] = useState({ name: '', address: '', startDate: today, expectedCompletionDate: '', budgetEstimate: '' })
  const [cameras, setCameras] = useState([newCamera(0)])
  const [clientMode, setClientMode] = useState('existing')
  const [clientId, setClientId] = useState('')
  const [newClient, setNewClient] = useState({ name: '', email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)

  // ADMIN only: engineers to put on the project. (An engineer creating a
  // project is always assigned to it by the server.)
  const isAdmin = user?.role === 'ADMIN'
  const [engineers, setEngineers] = useState(null)
  const [engineerIds, setEngineerIds] = useState([])
  const [engineerMode, setEngineerMode] = useState('existing')
  const [newEngineer, setNewEngineer] = useState({ name: '', email: '', password: '' })
  const [showEngineerPassword, setShowEngineerPassword] = useState(false)

  const [clients, setClients] = useState(null)
  const [clientsError, setClientsError] = useState('')
  const [quota, setQuota] = useState(null)
  const [limitMessage, setLimitMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/users/clients')
      .then((res) => {
        setClients(res.data)
        // Nobody to pick yet: start on "new client" instead of an empty list.
        if (res.data.length === 0) setClientMode('new')
      })
      .catch((err) => {
        setClients([])
        setClientsError(err.response?.data?.error || 'Could not load clients')
      })
    if (isAdmin) {
      api.get('/users', { params: { role: 'ENGINEER' } })
        .then((res) => {
          setEngineers(res.data)
          // Nobody to pick yet: start on "new engineer" instead of an empty list.
          if (res.data.length === 0) setEngineerMode('new')
        })
        .catch(() => setEngineers([]))
    }
    api.get('/projects/quota')
      .then((res) => {
        setQuota(res.data)
        if (!res.data.allowed) setLimitMessage(res.data.message)
      })
      .catch(() => setQuota(null))
  }, [])

  const setDetail = (field) => (e) => setDetails((d) => ({ ...d, [field]: e.target.value }))
  const setClientField = (field) => (e) => setNewClient((c) => ({ ...c, [field]: e.target.value }))
  const setEngineerField = (field) => (e) => setNewEngineer((c) => ({ ...c, [field]: e.target.value }))
  const updateCamera = (key, patch) => setCameras((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const body = {
        ...details,
        budgetEstimate: Number(details.budgetEstimate),
        cameras: cameras
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name.trim(), zone: c.zone, source: c.source.trim() || '0' })),
        ...(clientMode === 'existing' ? { clientId } : { newClient }),
        ...(isAdmin ? (engineerMode === 'existing' ? { engineerIds } : { newEngineer }) : {}),
      }
      const res = await api.post('/projects', body)
      onCreated(res.data)
    } catch (err) {
      if (err.response?.status === 402) {
        setLimitMessage(err.response.data.message || 'Your plan\'s project limit has been reached.')
      } else {
        setError(err.response?.data?.error || 'Could not create the project')
      }
    } finally {
      setSaving(false)
    }
  }

  const unnamedCameras = cameras.some((c) => !c.name.trim()) && cameras.length > 1
  const clientReady = clientMode === 'existing' ? Boolean(clientId) : newClient.name && newClient.email && isPasswordValid(newClient.password)
  // Engineers are optional for an admin (assignable later), but a new engineer
  // account must be complete.
  const engineerReady = !isAdmin || engineerMode === 'existing' || (newEngineer.name.trim() && newEngineer.email.trim() && isPasswordValid(newEngineer.password))
  const canSubmit = details.name.trim() && details.address.trim() && details.expectedCompletionDate && details.budgetEstimate !== '' && clientReady && engineerReady && !unnamedCameras

  return (
    <div className="new-project">
      <PageHeader
        eyebrow="New project"
        title="Create a project"
        subtitle="Add the basics now. Materials, workers, site updates and everything else are added from the project's page."
        breadcrumb={<><button type="button" onClick={onCancel}>Projects</button><Icon name="chevron-right" size={14} /><span>New project</span></>}
        actions={quota && quota.limit != null ? (
          <span className="new-project__quota">
            <Icon name="building-2" size={16} />
            {quota.current} of {quota.limit} open projects
          </span>
        ) : null}
      />

      <form onSubmit={handleSubmit} noValidate>
        {/* ▼ EDIT: New project form: "Project details" card (fields: name, address, dates, budget) */}
        <Card title="Project details" icon="building-2" className="ds-enter" style={{ '--i': 0 }}>
          <Input label="Project name" required value={details.name} onChange={setDetail('name')} placeholder="e.g. Riverside Tower Phase 2" maxLength={120} />
          <Input label="Address" required icon="map-pin" value={details.address} onChange={setDetail('address')} placeholder="Street, area, city" />
          <Grid columns={3}>
            <Input label="Start date" type="date" required value={details.startDate} onChange={setDetail('startDate')} />
            <Input label="Expected completion" type="date" required min={details.startDate} value={details.expectedCompletionDate} onChange={setDetail('expectedCompletionDate')} />
            <Input label="Budget (PKR)" type="number" required min="0" step="1000" value={details.budgetEstimate} onChange={setDetail('budgetEstimate')} placeholder="e.g. 2500000" />
          </Grid>
        </Card>

        <Card
          title="Cameras"
          subtitle="Name each camera location. Source: 0 = this laptop's webcam, 1 = a USB camera, or a camera URL."
          icon="cctv"
          className="ds-enter"
          style={{ '--i': 1 }}
          actions={
            <Button size="sm" variant="secondary" icon="plus" onClick={() => setCameras((l) => [...l, newCamera(l.length)])} disabled={cameras.length >= 20}>
              Add camera
            </Button>
          }
        >
          {cameras.length === 0 ? (
            <EmptyState compact icon="cctv" title="No cameras" message="You can add cameras now or later from the project's Live monitoring panel." />
          ) : (
            <ol className="new-project__cameras">
              {cameras.map((cam, i) => (
                <li key={cam.key} className="new-project__camera">
                  <span className="new-project__camera-index" aria-hidden="true">{i + 1}</span>
                  <Input label={`Camera ${i + 1} name`} value={cam.name} onChange={(e) => updateCamera(cam.key, { name: e.target.value })} placeholder="e.g. North Side" maxLength={80} />
                  <Select label="Zone" value={cam.zone} options={ZONES} onChange={(e) => updateCamera(cam.key, { zone: e.target.value })} />
                  <Input label="Source" value={cam.source} onChange={(e) => updateCamera(cam.key, { source: e.target.value })} hint={sourceHint(cam.source)} />
                  <Button variant="ghost" icon="trash-2" aria-label={`Remove camera ${i + 1}`} onClick={() => setCameras((l) => l.filter((c) => c.key !== cam.key))} />
                </li>
              ))}
            </ol>
          )}
          {unnamedCameras && <p className="ds-field__error">Give every camera a name, or remove the empty ones.</p>}
        </Card>

        {/* ▼ EDIT: New project form: "Client" card (existing / new client) */}
        <Card title="Client" subtitle="Who the project is for. They can log in to follow progress." icon="users" className="ds-enter" style={{ '--i': 2 }}>
          <SegmentedControl
            label="Client"
            value={clientMode}
            onChange={setClientMode}
            options={[{ value: 'existing', label: 'Existing client' }, { value: 'new', label: 'New client' }]}
          />
          <div className="new-project__client">
            {clientMode === 'existing' ? (
              clients === null ? (
                <Skeleton height={44} />
              ) : clients.length === 0 ? (
                <EmptyState
                  compact
                  icon="users"
                  title="No clients to choose from"
                  message={clientsError || (user?.role === 'ENGINEER' ? 'Only clients from your own projects are listed. Create a new client instead.' : 'There are no client accounts yet.')}
                  action={<Button size="sm" onClick={() => setClientMode('new')}>Create a new client</Button>}
                />
              ) : (
                <Select label="Choose a client" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Select a client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.email}</option>)}
                </Select>
              )
            ) : (
              <Grid columns={3}>
                <Input label="Client name" required value={newClient.name} onChange={setClientField('name')} placeholder="Full name or company" autoComplete="off" />
                <Input label="Email (login)" required type="email" icon="mail" value={newClient.email} onChange={setClientField('email')} placeholder="client@company.com" autoComplete="off" />
                <div className="new-project__password">
                  <Input
                    label="Login password"
                    required
                    type={showPassword ? 'text' : 'password'}
                    icon="lock"
                    value={newClient.password}
                    onChange={setClientField('password')}
                    autoComplete="new-password"
                    hint={`${PASSWORD_HINT} Share it with the client securely.`}
                    error={passwordProblem(newClient.password)}
                  />
                  <button type="button" className="new-project__reveal" onClick={() => setShowPassword((s) => !s)} aria-pressed={showPassword}>
                    <Icon name="eye" size={16} /> {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Grid>
            )}
          </div>
        </Card>

        {isAdmin && (
          <Card title="Engineers" subtitle="Who works on this project. They can manage it and its cameras." icon="hard-hat" className="ds-enter" style={{ '--i': 3 }}>
            <SegmentedControl
              label="Engineer"
              value={engineerMode}
              onChange={setEngineerMode}
              options={[{ value: 'existing', label: 'Existing engineer' }, { value: 'new', label: 'New engineer' }]}
            />
            <div className="new-project__client">
            {engineerMode === 'new' ? (
              <Grid columns={3}>
                <Input label="Engineer name" required value={newEngineer.name} onChange={setEngineerField('name')} placeholder="Full name" autoComplete="off" />
                <Input label="Email (login)" required type="email" icon="mail" value={newEngineer.email} onChange={setEngineerField('email')} placeholder="engineer@company.com" autoComplete="off" />
                <div className="new-project__password">
                  <Input
                    label="Login password"
                    required
                    type={showEngineerPassword ? 'text' : 'password'}
                    icon="lock"
                    value={newEngineer.password}
                    onChange={setEngineerField('password')}
                    autoComplete="new-password"
                    hint={`${PASSWORD_HINT} Share it with the engineer securely.`}
                    error={passwordProblem(newEngineer.password)}
                  />
                  <button type="button" className="new-project__reveal" onClick={() => setShowEngineerPassword((s) => !s)} aria-pressed={showEngineerPassword}>
                    <Icon name="eye" size={16} /> {showEngineerPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Grid>
            ) : engineers === null ? (
              <Skeleton height={44} />
            ) : engineers.length === 0 ? (
              <EmptyState
                compact
                icon="hard-hat"
                title="No engineers yet"
                message="Create an engineer account for this project, or assign one later from the project page."
                action={<Button size="sm" onClick={() => setEngineerMode('new')}>Create a new engineer</Button>}
              />
            ) : (
              <div className="new-project__engineers">
                {engineers.map((eng) => (
                  <label key={eng.id} className="new-project__engineer">
                    <input
                      type="checkbox"
                      checked={engineerIds.includes(eng.id)}
                      onChange={(e) => setEngineerIds((ids) => (e.target.checked ? [...ids, eng.id] : ids.filter((id) => id !== eng.id)))}
                    />
                    <span><strong>{eng.name}</strong><span className="ds-caption">{eng.email}</span></span>
                  </label>
                ))}
              </div>
            )}
            </div>
          </Card>
        )}

        {error && <p className="ds-field__error new-project__error" role="alert"><Icon name="circle-alert" size={16} /> {error}</p>}

        {/* ▼ EDIT: Cancel / Create project buttons at the bottom (styles: NewProjectPage.css) */}
        <div className="new-project__actions">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="lg" icon="plus" loading={saving} disabled={!canSubmit}>Create project</Button>
        </div>
      </form>

      <Modal
        open={Boolean(limitMessage)}
        title="Project limit reached"
        onClose={() => setLimitMessage('')}
        footer={
          <>
            <Button variant="ghost" onClick={onCancel}>Back to projects</Button>
            {user?.role === 'ADMIN' && onOpenBilling && <Button icon="credit-card" onClick={onOpenBilling}>Upgrade plan</Button>}
          </>
        }
      >
        <div className="new-project__limit">
          <span className="new-project__limit-icon"><Icon name="triangle-alert" size={22} /></span>
          <p>{limitMessage}</p>
        </div>
      </Modal>
    </div>
  )
}
