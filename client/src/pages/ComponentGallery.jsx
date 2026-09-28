import { useState } from 'react'
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorState, FileInput, Grid, Icon, Input, Modal, PageHeader,
  ProgressBar, Row, SectionHeader, SegmentedControl, Select, Skeleton, StatCard, Table, Tabs, Textarea,
  ToastRegion, Tooltip, statusVariant, useToasts,
} from '../components/ui'
import { iconNames } from '../components/icons/Icon'
import { colors } from '../styles/designSystem'
import './ComponentGallery.css'

/**
 * Every component and variant rendered in isolation, for visual review and
 * manual accessibility checks (tab order, focus rings, contrast). The sample
 * values below are gallery placeholders only - no real page shows them.
 */
const SWATCHES = [
  ['bg', colors.bg], ['surface', colors.surface], ['surface-dark', colors.surfaceDark], ['surface-dark-2', colors.surfaceDark2],
  ['text', colors.text], ['text-muted', colors.textMuted], ['border', colors.border], ['accent', colors.accent],
  ['accent-strong', colors.accentStrong], ['success', colors.success], ['warning', colors.warning], ['danger', colors.danger], ['info', colors.info],
]

const SAMPLE_ROWS = [
  { id: 1, name: 'Sample project A', status: 'ACTIVE', owner: 'client-a@example.com', value: 1250 },
  { id: 2, name: 'Sample project B', status: 'PLANNING', owner: 'client-b@example.com', value: 830 },
  { id: 3, name: 'Sample project C', status: 'ON_HOLD', owner: 'client-c@example.com', value: 92 },
]

export default function ComponentGallery({ onBack }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [loadingBtn, setLoadingBtn] = useState(false)
  const [tab, setTab] = useState('overview')
  const [range, setRange] = useState('weekly')
  const [text, setText] = useState('')
  const { toasts, push, dismiss } = useToasts()

  const columns = [
    { key: 'name', header: 'Project', render: (r) => <strong>{r.name}</strong> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={statusVariant(r.status)} dot>{r.status.replace('_', ' ')}</Badge> },
    { key: 'owner', header: 'Owner' },
    { key: 'value', header: 'Qty', align: 'right', render: (r) => r.value.toLocaleString() },
    { key: 'actions', header: '', align: 'right', render: () => <Button size="sm" variant="ghost" icon="pencil" aria-label="Edit" /> },
  ]

  const demoLoading = () => {
    setLoadingBtn(true)
    setTimeout(() => setLoadingBtn(false), 1600)
  }

  return (
    <div className="gallery">
      <ToastRegion toasts={toasts} onDismiss={dismiss} />

      <PageHeader
        eyebrow="Design system"
        title="Component gallery"
        subtitle="Every token, component and state in the BuildSite 360 UI kit. Tab through the page to check focus rings."
        breadcrumb={onBack ? <><button type="button" onClick={onBack}>Projects</button><Icon name="chevron-right" size={14} /><span>Components</span></> : null}
        actions={onBack ? <Button variant="secondary" icon="arrow-left" onClick={onBack}>Back</Button> : null}
      />

      {/* Dark emphasis block */}
      <section className="gallery__hero ds-on-dark">
        <div className="gallery__hero-glow" aria-hidden="true" />
        <div className="ds-eyebrow">Light for work · dark for emphasis</div>
        <h2 className="gallery__hero-title">Site intelligence, <span>in real time</span>.</h2>
        <p className="gallery__hero-copy">Dark surfaces carry banners, the sidebar and key summaries. Data-dense screens stay light.</p>
        <Row>
          <Button icon="plus">Primary action</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost" iconRight="chevron-right">Ghost</Button>
        </Row>
      </section>

      <SectionHeader title="Colour tokens" subtitle="Accent is a fill on light surfaces; accent-strong is the accessible text/link colour." icon="palette" />
      <div className="gallery__swatches">
        {SWATCHES.map(([name, value]) => (
          <div key={name} className="gallery__swatch">
            <span style={{ background: value }} />
            <strong>--{name}</strong>
            <code>{value}</code>
          </div>
        ))}
      </div>

      <SectionHeader title="Typography" subtitle="Inter · tabular numbers for KPIs and tables" icon="file-text" />
      <Card>
        <div className="gallery__type">
          <div><span className="ds-caption">Hero · 40/700</span><h1 style={{ margin: 0 }}>Construction, monitored.</h1></div>
          <div><span className="ds-caption">Section · 24/600</span><h2 style={{ margin: 0 }}>Safety overview</h2></div>
          <div><span className="ds-caption">Body · 16/400</span><p style={{ margin: 0 }}>Body copy is set at 16px for comfortable reading on every screen size.</p></div>
          <div><span className="ds-caption">Secondary · 14</span><p className="ds-muted" style={{ margin: 0, fontSize: 14 }}>Secondary information and helper text.</p></div>
          <div><span className="ds-caption">Label · 12/500 tracked</span><div className="ds-field__label">Field label</div></div>
          <div><span className="ds-caption">Numbers</span><div className="ds-num" style={{ fontSize: 28, fontWeight: 700 }}>1,204 · 89.75%</div></div>
        </div>
      </Card>

      <SectionHeader title="Buttons" subtitle="Hover lifts, press scales to 0.98, loading keeps the width" icon="layers" />
      <Card>
        <div className="gallery__stack">
          <Row>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="dark">Dark</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </Row>
          <Row>
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg">Large</Button>
          </Row>
          <Row>
            <Button icon="download">With icon</Button>
            <Button variant="secondary" iconRight="chevron-right">Trailing icon</Button>
            <Button loading={loadingBtn} onClick={demoLoading} icon="refresh-cw">Generate report</Button>
            <Button disabled>Disabled</Button>
            <Tooltip label="Edit"><Button variant="secondary" icon="pencil" aria-label="Edit" /></Tooltip>
            <Tooltip label="Delete"><Button variant="ghost" icon="trash-2" aria-label="Delete" /></Tooltip>
          </Row>
        </div>
      </Card>

      <SectionHeader title="Form fields" subtitle="44px controls, accent focus ring, inline errors" icon="pencil" />
      <Card>
        <Grid columns={2}>
          <div>
            <Input label="Email" icon="mail" type="email" placeholder="name@company.com" value={text} onChange={(e) => setText(e.target.value)} />
            <Input label="Password" icon="lock" type="password" placeholder="••••••••" hint="At least 8 characters" />
            <Input label="With error" defaultValue="not-an-email" error="Enter a valid email address" required />
            <Input label="Disabled" defaultValue="Can't change this" disabled />
            <Input label="Read-only" defaultValue="Read-only value" readOnly />
          </div>
          <div>
            <Select label="Zone" options={[{ value: 'ENTRANCE', label: 'Entrance' }, { value: 'WORK_AREA', label: 'Work area' }, { value: 'STORAGE', label: 'Storage' }]} />
            <Input label="Date" type="date" />
            <Input label="Time" type="time" />
            <Textarea label="Notes" placeholder="Describe the site update…" />
            <FileInput label="Photo" accept="image/*" hint="JPG or PNG" />
          </div>
        </Grid>
      </Card>

      <SectionHeader title="Cards" subtitle="Light and dark, with icon, subtitle and actions" icon="layout-dashboard" />
      <Grid columns={3}>
        <Card title="Light card" subtitle="Default surface" icon="building-2" actions={<Button size="sm" variant="ghost" icon="eye" aria-label="View" />}>
          <p className="ds-muted" style={{ margin: 0 }}>Cards group related content with a 16px radius and a soft shadow.</p>
        </Card>
        <Card variant="dark" title="Dark card" subtitle="Emphasis surface" icon="shield-alert">
          <p className="ds-muted" style={{ margin: 0 }}>Used for summaries, highlights and call-to-action blocks.</p>
        </Card>
        <Card interactive title="Interactive card" subtitle="Hover to lift" icon="map-pin" tabIndex={0}>
          <p className="ds-muted" style={{ margin: 0 }}>Clickable cards lift slightly on hover.</p>
        </Card>
      </Grid>

      <SectionHeader title="KPI cards" subtitle="Numbers count up on first load" icon="chart-column" />
      <Grid columns={4}>
        <StatCard icon="building-2" label="Projects" value={12} sub="Sample value" />
        <StatCard icon="user-check" label="Check-ins" value={1204} />
        <StatCard icon="shield-alert" label="Violations" value={9} tone="danger" />
        <StatCard icon="percent" label="Completed" value={89.75} suffix="%" variant="dark" />
      </Grid>
      <div style={{ height: 16 }} />
      <Grid columns={4}>
        <StatCard icon="package" label="Loading state" loading />
        <StatCard icon="triangle-alert" label="Warning tone" value={2} tone="warning" />
        <StatCard icon="info" label="Info tone" value={5} tone="info" />
        <StatCard icon="activity" label="Text value" value="—" sub="No data yet" />
      </Grid>

      <SectionHeader title="Badges & progress" icon="radio" />
      <Card>
        <div className="gallery__stack">
          <Row>
            <Badge>Neutral</Badge>
            <Badge variant="success" dot>Active</Badge>
            <Badge variant="warning" dot>On hold</Badge>
            <Badge variant="danger" dot>No helmet</Badge>
            <Badge variant="info" dot>Planning</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="dark">Dark</Badge>
            <Badge variant="danger" pulse>LIVE</Badge>
            <Badge variant="success" pulse>Online</Badge>
            <Badge variant="info" icon="user-check">With icon</Badge>
          </Row>
          <div className="gallery__progress">
            {[[0.92, 'accent'], [0.74, 'success'], [0.55, 'warning'], [0.3, 'danger']].map(([v, variant]) => (
              <div key={variant}><span className="ds-caption">{variant} · {Math.round(v * 100)}%</span><ProgressBar value={v} variant={variant} label={`${variant} example`} /></div>
            ))}
          </div>
        </div>
      </Card>

      <SectionHeader title="Tabs & segmented control" icon="panel-left" />
      <Card>
        <div className="gallery__stack">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
              { id: 'cameras', label: 'Cameras', icon: 'cctv' },
              { id: 'safety', label: 'Safety', icon: 'shield-alert', badge: 3 },
              { id: 'chat', label: 'Chat', icon: 'message-square' },
            ]}
          />
          <SegmentedControl label="Range" value={range} onChange={setRange} options={['daily', 'weekly', 'monthly'].map((v) => ({ value: v, label: v }))} />
        </div>
      </Card>

      <SectionHeader title="Table" subtitle="Sticky header, row hover, right-aligned numbers, loading and empty states" icon="clipboard-list" />
      <Table columns={columns} rows={SAMPLE_ROWS} />
      <div style={{ height: 16 }} />
      <Grid columns={2}>
        <Table columns={columns.slice(0, 3)} rows={[]} loading />
        <Table columns={columns.slice(0, 3)} rows={[]} empty="No projects yet" />
      </Grid>

      <SectionHeader title="Avatars, skeletons & states" icon="users" />
      <Grid columns={3}>
        <Card title="Avatars">
          <Row>
            <Avatar name="admin@example.com" />
            <Avatar name="Site Engineer" variant="dark" />
            <Avatar name="client@example.com" variant="neutral" />
            <Avatar name="Big Avatar" size={52} />
          </Row>
        </Card>
        <Card title="Skeleton">
          <Skeleton height={20} width="50%" />
          <div style={{ height: 12 }} />
          <Skeleton lines={3} />
        </Card>
        <Card title="Empty state" flush>
          <EmptyState compact icon="clipboard-list" title="No updates yet" message="Site updates will appear here." action={<Button size="sm" icon="plus">Add</Button>} />
        </Card>
      </Grid>
      <Card flush>
        <ErrorState message="Couldn't load this section." onRetry={() => push({ variant: 'info', title: 'Retry pressed' })} />
      </Card>

      <SectionHeader title="Overlays" subtitle="Modal: blur backdrop, focus trapped, ESC to close · Toast: slide-in with countdown" icon="layers" />
      <Card>
        <Row>
          <Button variant="dark" onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button variant="secondary" onClick={() => push({ variant: 'success', title: 'Saved', message: 'The change was saved.' })}>Success toast</Button>
          <Button variant="secondary" onClick={() => push({ variant: 'danger', title: 'NO HELMET detected — unidentified person', message: 'West Side · confidence 0.83' })}>Alert toast</Button>
          <Button variant="secondary" onClick={() => push({ variant: 'info', title: 'Heads up', message: 'Informational message.' })}>Info toast</Button>
        </Row>
      </Card>

      <Modal
        open={modalOpen}
        title="Move the webcam?"
        onClose={() => setModalOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={() => setModalOpen(false)}>Confirm</Button></>}
      >
        <p style={{ margin: 0 }} className="ds-muted">Dialogs trap focus - Tab cycles inside - and return focus to the button that opened them.</p>
        <Input label="Focusable field" placeholder="Tab to cycle" />
      </Modal>

      <SectionHeader title={`Icons (${iconNames.length})`} subtitle="Lucide, ISC licensed, vendored by scripts/fetch-icons.mjs" icon="palette" />
      <div className="gallery__icons">
        {iconNames.map((name) => (
          <div key={name} className="gallery__icon">
            <Icon name={name} size={22} />
            <span>{name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
