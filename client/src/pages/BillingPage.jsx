import { useEffect, useState } from 'react'
import api from '../api/axios'
import { Badge, Button, Card, statusVariant } from '../components/ui'

export default function BillingPage() {
  const [plans, setPlans] = useState([])
  const [current, setCurrent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [plansRes, subRes] = await Promise.all([
          api.get('/billing/plans'),
          api.get('/billing/subscription'),
        ])
        setPlans(plansRes.data)
        setCurrent(subRes.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load billing information')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const subscribe = async (plan) => {
    setMessage('')
    try {
      const res = await api.post('/billing/checkout', { plan, provider: 'EASYPAISA' })
      window.open(res.data.checkoutUrl, '_blank', 'noopener')
      setMessage(`Sandbox checkout opened for ${plan} (order ${res.data.orderRef}).`)
    } catch (err) {
      setMessage(err.response?.data?.error || 'Checkout failed')
    }
  }

  if (loading) return <Card title="Billing"><p className="ds-muted">Loading billing…</p></Card>
  if (error) return <Card title="Billing"><p className="ds-field__error" role="alert">{error}</p></Card>

  const subscription = current?.subscription

  return (
    <>
      <Card
        title="Subscription"
        subtitle="Sandbox mode — no real payments are processed"
        actions={<Badge variant="warning">Sandbox</Badge>}
      >
        {subscription ? (
          <div className="stat-grid">
            <div className="stat">
              <div className="stat__value">{subscription.plan}</div>
              <div className="stat__label">Current plan</div>
            </div>
            <div className="stat">
              <div className="stat__value" style={{ fontSize: '1.1rem', paddingTop: 6 }}>
                <Badge variant={statusVariant(subscription.status)} dot>{subscription.status}</Badge>
              </div>
              <div className="stat__label">Status</div>
            </div>
            <div className="stat">
              <div className="stat__value" style={{ fontSize: '1.1rem' }}>
                {new Date(subscription.nextBillingDate).toLocaleDateString()}
              </div>
              <div className="stat__label">Next billing date</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                {current.projectCount}
                <span className="ds-muted" style={{ fontSize: '1rem' }}> / {current.projectLimit}</span>
              </div>
              <div className="stat__label">Projects used</div>
            </div>
          </div>
        ) : (
          <p className="ds-muted">No active subscription.</p>
        )}
      </Card>

      <Card title="Plans">
        {message && <p className="ds-field__hint" role="status">{message}</p>}
        <div className="plan-grid">
          {plans.map((p) => {
            const isCurrent = subscription?.plan === p.plan && subscription?.status === 'ACTIVE'
            return (
              <div className="ds-card" key={p.plan} style={{ marginBottom: 0 }}>
                <div className="ds-card__body">
                  <h4>{p.plan}</h4>
                  <div className="plan-card__price">
                    {p.price.toLocaleString()} <span className="plan-card__period">{p.currency}/month</span>
                  </div>
                  <p className="ds-caption" style={{ marginTop: 'var(--space-sm)' }}>
                    {p.projectLimit === 'unlimited' ? 'Unlimited projects' : `Up to ${p.projectLimit} projects`}
                  </p>
                  <Button
                    fullWidth
                    variant={isCurrent ? 'secondary' : 'primary'}
                    disabled={isCurrent}
                    onClick={() => subscribe(p.plan)}
                  >
                    {isCurrent ? 'Current plan' : `Subscribe to ${p.plan}`}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </>
  )
}
