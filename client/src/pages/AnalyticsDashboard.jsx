import { useEffect, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import api from '../api/axios'
import { Card } from '../components/ui'
import { chartColors, chartTheme, typography } from '../styles/designSystem'

// Shared axis/tooltip styling so every chart reads as part of one system.
const axisProps = {
  stroke: chartTheme.axis,
  tick: { fill: chartTheme.text, fontSize: 12 },
  tickLine: false,
}

const tooltipProps = {
  contentStyle: {
    background: chartTheme.tooltipBg,
    border: `1px solid ${chartTheme.tooltipBorder}`,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: typography.fontFamily,
  },
  cursor: { fill: 'rgba(31, 111, 178, 0.06)' },
}

const legendProps = {
  wrapperStyle: { fontSize: 13, color: chartTheme.text },
}

export default function AnalyticsDashboard({ projectId }) {
  const [summary, setSummary] = useState(null)
  const [attendance, setAttendance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [analyticsRes, attendanceRes] = await Promise.all([
          api.get(`/projects/${projectId}/analytics`),
          api.get(`/projects/${projectId}/attendance?range=monthly`),
        ])
        setSummary(analyticsRes.data)
        setAttendance(attendanceRes.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load analytics')
      } finally {
        setLoading(false)
      }
    }
    if (projectId) load()
  }, [projectId])

  if (loading) return <Card title="Analytics"><p className="ds-muted">Loading analytics…</p></Card>
  if (error) return <Card title="Analytics"><p className="ds-field__error" role="alert">{error}</p></Card>
  if (!summary) return null

  const violationData = summary.safety.byType.map((v) => ({
    name: v.violationType.replace('_', ' '),
    count: v.count,
  }))

  const attendanceData = (attendance?.workers || []).map((w) => ({
    name: w.name,
    daysPresent: w.daysPresent,
  }))

  const materialData = summary.materials.items.map((m) => ({
    name: m.name,
    received: m.totalReceived,
    consumed: m.totalConsumed,
  }))

  const stats = [
    { label: 'Site updates', value: summary.siteUpdates.total },
    { label: 'Check-ins', value: summary.attendance.totalCheckins },
    { label: 'Unique workers', value: summary.attendance.uniqueWorkers },
    { label: 'Safety violations', value: summary.safety.totalViolations, alert: summary.safety.totalViolations > 0 },
    { label: 'Material discrepancies', value: summary.materials.discrepancyCount, alert: summary.materials.discrepancyCount > 0 },
  ]

  return (
    <>
      <Card
        title="Overview"
        subtitle={`${summary.range.from.slice(0, 10)} to ${summary.range.to.slice(0, 10)}`}
      >
        <div className="stat-grid">
          {stats.map((s) => (
            <div className="stat" key={s.label}>
              <div className={`stat__value ${s.alert ? 'stat__value--alert' : ''}`}>{s.value}</div>
              <div className="stat__label">{s.label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/*
       * Charts need horizontal room for axis labels to stay legible; below
       * 1024px .chart-grid collapses to a single column rather than shrinking
       * both charts until their labels collide.
       */}
      <div className="chart-grid">
        <Card title="Safety violations by type">
          {violationData.length === 0 ? (
            <p className="ds-muted">No violations in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={violationData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip {...tooltipProps} />
                <Legend {...legendProps} />
                <Bar dataKey="count" name="Violations" fill={chartColors[4]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Attendance (last 30 days)">
          {attendanceData.length === 0 ? (
            <p className="ds-muted">No attendance records in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={attendanceData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip {...tooltipProps} />
                <Legend {...legendProps} />
                <Line
                  type="monotone"
                  dataKey="daysPresent"
                  name="Days present"
                  stroke={chartColors[0]}
                  strokeWidth={2}
                  dot={{ r: 4, fill: chartColors[0] }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Materials: received vs consumed">
        {materialData.length === 0 ? (
          <p className="ds-muted">No material entries in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={materialData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipProps} />
              <Legend {...legendProps} />
              <Bar dataKey="received" name="Received" fill={chartColors[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="consumed" name="Consumed" fill={chartColors[1]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </>
  )
}
