import { useState } from 'react'
import {
  Button, Input, Select, Card, Badge, Table, Modal, ToastRegion, useToasts,
  Stack, Row, Grid, statusVariant,
} from '../components/ui'
import { colors, spacing, typography } from '../styles/designSystem'

/**
 * Every component rendered in isolation, for visual review and manual
 * accessibility checks (tab order, focus rings, contrast).
 */
export default function ComponentGallery({ onBack }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const { toasts, push, dismiss } = useToasts()

  const demoRows = [
    { id: 1, name: 'Riverside Tower', status: 'ACTIVE', client: 'client1@test.com' },
    { id: 2, name: 'Lakeside Villas', status: 'PLANNING', client: 'client2@test.com' },
    { id: 3, name: 'Harbour Point', status: 'ON_HOLD', client: 'client3@test.com' },
  ]

  return (
    <div style={{ padding: spacing.lg, maxWidth: 1100, margin: '0 auto' }}>
      <ToastRegion toasts={toasts} onDismiss={dismiss} />

      <Row className="ds-row">
        {onBack && <Button variant="ghost" onClick={onBack}>&larr; Back</Button>}
        <h1 style={{ margin: 0 }}>Component Gallery</h1>
      </Row>
      <p className="ds-muted">Every library component in isolation. Tab through the page to check focus order and rings.</p>

      {/* ---- Tokens ---- */}
      <Card title="Colour tokens" subtitle="Contrast-checked against WCAG AA where used for text">
        <Grid columns={3}>
          {[
            ['primary600', colors.primary600, 'Body text on white — 5.7:1'],
            ['neutral900', colors.neutral900, 'Default text — 15.8:1'],
            ['neutral500', colors.neutral500, 'Muted text — 4.8:1'],
            ['success', colors.success, 'Online / received — 4.9:1'],
            ['warning', colors.warning, 'On hold / consumed — 5.9:1'],
            ['danger', colors.danger, 'Violations / errors — 6.4:1'],
          ].map(([name, value, note]) => (
            <div key={name}>
              <div style={{ background: value, height: 44, borderRadius: 6, marginBottom: 6 }} />
              <div style={{ fontWeight: 600, fontSize: typography.caption.fontSize }}>{name}</div>
              <div className="ds-caption">{value} — {note}</div>
            </div>
          ))}
        </Grid>
      </Card>

      <Card title="Typography scale">
        <h1>Heading 1 — 2rem</h1>
        <h2>Heading 2 — 1.5rem</h2>
        <h3>Heading 3 — 1.25rem</h3>
        <h4>Heading 4 — 1.0625rem</h4>
        <p>Body — 0.9375rem. The default for paragraphs and table cells.</p>
        <p className="ds-caption">Caption — 0.8125rem. Hints, timestamps, secondary detail.</p>
      </Card>

      <Card title="Spacing scale" subtitle="8px base">
        <Row>
          {Object.entries(spacing).map(([name, value]) => (
            <div key={name} style={{ textAlign: 'center' }}>
              <div style={{ width: value, height: 28, background: colors.primary300, borderRadius: 3 }} />
              <div className="ds-caption">{name}<br />{value}</div>
            </div>
          ))}
        </Row>
      </Card>

      {/* ---- Buttons ---- */}
      <Card title="Button">
        <Stack>
          <Row>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
          </Row>
          <Row>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </Row>
          <Row>
            <Button disabled>Disabled</Button>
            <Button variant="secondary" disabled>Disabled secondary</Button>
          </Row>
        </Stack>
      </Card>

      {/* ---- Inputs ---- */}
      <Card title="Input & Select">
        <Grid columns={2}>
          <div>
            <Input
              label="Project name"
              placeholder="e.g. Riverside Tower"
              required
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              hint="Shown across dashboards and reports"
            />
            <Input label="Email" type="email" placeholder="name@example.com" />
            <Input label="Password" type="password" placeholder="••••••••" />
          </div>
          <div>
            <Input label="With error" defaultValue="not-an-email" error="Enter a valid email address" />
            <Input label="Disabled" defaultValue="Read only" disabled />
            <Select
              label="Camera zone"
              required
              options={[
                { value: 'ENTRANCE', label: 'Entrance' },
                { value: 'WORK_AREA', label: 'Work area' },
                { value: 'STORAGE', label: 'Storage' },
              ]}
            />
          </div>
        </Grid>
      </Card>

      {/* ---- Badges ---- */}
      <Card title="Badge" subtitle="Colour is never the only signal — each badge carries a text label">
        <Stack>
          <Row>
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="danger">Danger</Badge>
            <Badge variant="info">Info</Badge>
          </Row>
          <Row>
            <Badge variant={statusVariant('ONLINE')} dot>ONLINE</Badge>
            <Badge variant={statusVariant('OFFLINE')} dot>OFFLINE</Badge>
            <Badge variant={statusVariant('ACTIVE')}>ACTIVE</Badge>
            <Badge variant={statusVariant('ON_HOLD')}>ON HOLD</Badge>
            <Badge variant={statusVariant('NO_HELMET')}>NO HELMET</Badge>
            <Badge variant={statusVariant('NO_VEST')}>NO VEST</Badge>
          </Row>
        </Stack>
      </Card>

      {/* ---- Table ---- */}
      <Card title="Table" subtitle="Rows are keyboard-activatable when clickable" flush>
        <Table
          columns={[
            { key: 'name', header: 'Project' },
            { key: 'status', header: 'Status', render: (r) => <Badge variant={statusVariant(r.status)}>{r.status}</Badge> },
            { key: 'client', header: 'Client' },
          ]}
          rows={demoRows}
          onRowClick={(row) => push({ variant: 'info', title: 'Row activated', message: row.name })}
        />
      </Card>

      <Card title="Table — empty state" flush>
        <Table
          columns={[{ key: 'name', header: 'Project' }, { key: 'status', header: 'Status' }]}
          rows={[]}
          empty="No projects yet"
        />
      </Card>

      {/* ---- Modal & Toast ---- */}
      <Card title="Modal & Toast">
        <Row>
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button variant="secondary" onClick={() => push({ variant: 'info', title: 'Info', message: 'A neutral notification.' })}>Info toast</Button>
          <Button variant="secondary" onClick={() => push({ variant: 'success', title: 'Saved', message: 'Changes stored.' })}>Success toast</Button>
          <Button variant="secondary" onClick={() => push({ variant: 'warning', title: 'Check materials', message: 'Bricks consumption exceeds received.' })}>Warning toast</Button>
          <Button variant="danger" onClick={() => push({ variant: 'danger', title: 'Safety alert', message: 'NO_HELMET on Work Area North (0.94)' })}>Danger toast</Button>
        </Row>
      </Card>

      <Modal
        open={modalOpen}
        title="Example dialog"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => setModalOpen(false)}>Confirm</Button>
          </>
        }
      >
        <p>Escape closes this, clicking the overlay closes it, and focus moves into the dialog on open.</p>
        <Input label="A field inside the dialog" placeholder="Type here" />
      </Modal>
    </div>
  )
}
