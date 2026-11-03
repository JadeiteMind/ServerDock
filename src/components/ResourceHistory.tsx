import { useEffect, useState } from 'react'
import { api } from '../services/api'
import type { HistoryPoint, Snapshot } from '../types/models'

interface Point { timestamp: number; value: number }
const diskKey = (id: string) => 'serverdock.diskTrend.' + id
const day = 86400
function diskPoints(id: string): Point[] {
  try { return JSON.parse(localStorage.getItem(diskKey(id)) ?? '[]') } catch { return [] }
}
export function recordDiskTrend(id: string, sample: Snapshot) {
  if (!sample.disks?.length) return
  const total = sample.disks.reduce((sum, disk) => sum + disk.totalBytes, 0)
  if (!total) return
  const timestamp = sample.timestamp
  const value = 100 * sample.disks.reduce((sum, disk) => sum + disk.usedBytes, 0) / total
  const points = diskPoints(id).filter(point => point.timestamp > timestamp - day && point.timestamp < timestamp)
  try { localStorage.setItem(diskKey(id), JSON.stringify([...points, { timestamp, value }].slice(-1500))) } catch { /* Storage may be unavailable. */ }
}
export function Trend({ title, points, end }: { title: string; points: Point[]; end: number }) {
  const coordinates = points.map(point => {
    const x = (point.timestamp - end + day) * 600 / day
    return [x, 100 - Math.max(0, Math.min(100, point.value))]
  })
  const segments = coordinates.reduce<string[]>((paths, [x, y], i) => {
    if (!i || points[i].timestamp - points[i - 1].timestamp > 600) paths.push(`M ${x} ${y}`)
    else paths[paths.length - 1] += ` L ${x} ${y}`
    return paths
  }, [])
  return <section className="sd-panel">
    <h2>{title}</h2>
    {points.length ? <>
      <p>最近采样 {points.at(-1)!.value.toFixed(1)}%</p>
      <svg role="img" aria-label={title + '过去 24 小时趋势，纵轴 0 到 100%'} viewBox="0 0 600 100" style={{ width: '100%', height: 120, background: '#faf4fc' }} preserveAspectRatio="none">
        <path d="M0 50H600" stroke="#c8aed0" strokeDasharray="5 5" />
        {segments.map((path, i) => <path key={i} d={path} fill="none" stroke="#660874" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
        {coordinates.map(([x,y], i) => <circle key={i} cx={x} cy={y} r="1.5" fill="#660874" />)}
      </svg>
      <p>24 小时前 → 现在 · 纵轴 0–100%</p>
    </> : <p>过去 24 小时暂无采样。</p>}
  </section>
}
export function ResourceHistory({ serverId, alerts, onAlertsChange }: { serverId: string; alerts: boolean; onAlertsChange: (enabled: boolean) => void }) {
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [error, setError] = useState('')
  const [end, setEnd] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const now = Math.floor(Date.now() / 1000)
      try {
        const points = await api.getHistory(serverId, now - day, 300)
        if (!cancelled) { setHistory(points); setEnd(now); setError('') }
      } catch (reason) { if (!cancelled) setError(String(reason)) }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [serverId])
  return <>
    <section className="sd-panel"><h2>过去 24 小时</h2><label><input style={{ width: 'auto', minHeight: 0 }} type="checkbox" checked={alerts} onChange={event => onAlertsChange(event.target.checked)} /> 启用资源异常通知</label><p>CPU、内存或存储持续达到 90% 五分钟时提醒，每种资源恢复后才会再次提醒。</p>{error && <p role="alert">读取历史失败：{error}</p>}</section>
    <Trend title="CPU 使用率" points={history.map(point => ({ timestamp: point.timestamp, value: point.cpuUtilization }))} end={end} />
    <Trend title="内存使用率" points={history.map(point => ({ timestamp: point.timestamp, value: point.memoryUtilization }))} end={end} />
    <Trend title="存储使用率" points={diskPoints(serverId).filter(point => point.timestamp >= end - day)} end={end} />
  </>
}
