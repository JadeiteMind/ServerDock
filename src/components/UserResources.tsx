import { UserStorage } from './UserStorage'
import { useState } from 'react'
import type { Snapshot } from '../types/models'

const memory = (value: number) => `${(value / 1024 ** 3).toFixed(2)} GiB`

export function UserResources({ snapshot, serverId }: { snapshot?: Snapshot; serverId?: string }) {
  const [includeSystem, setIncludeSystem] = useState(false)
  const all = snapshot?.userResources ?? []
  const rows = all.filter(user => includeSystem || !user.isSystem)
  if (!snapshot?.userResourcesSampled) return <section className="sd-panel"><h2>用户资源</h2><p>等待完整用户采样。不会用前 64 条进程列表推算整机用户数。</p></section>
  const totalCpu = rows.reduce((sum, user) => sum + (user.cpuUtilization ?? 0), 0)
  const cpuKnown = rows.some(user => user.cpuUtilization !== null)
  const processCount = rows.reduce((sum, user) => sum + user.processCount, 0)
  return <><section className="sd-panel sd-users">
    <div className="sd-section-heading"><h2>用户资源</h2><label className="sd-system-toggle"><input type="checkbox" checked={includeSystem} onChange={event => setIncludeSystem(event.target.checked)} />包含系统账号</label></div>
    <div className="sd-stats"><div><small>当前资源用户</small><strong>{rows.length}<span> 人</span></strong></div><div><small>可见进程</small><strong>{processCount}</strong></div><div><small>采样区间 CPU · 整机占比</small><strong>{cpuKnown ? `${totalCpu.toFixed(1)}%` : '—'}</strong></div><div><small>进程 RSS 合计</small><strong>{memory(rows.reduce((sum, user) => sum + user.memoryUsedBytes, 0))}</strong></div></div>
    <p>按 UID 统计当前拥有可见进程的不同用户；不等同于登录会话数。采样于 {new Date(snapshot.timestamp * 1000).toLocaleTimeString()}，随服务器采样自动刷新。</p>
    <div className="sd-table-wrap"><table><thead><tr><th>用户</th><th>UID</th><th>进程数</th><th>CPU · 整机 %</th><th>内存 RSS</th><th>RSS / 整机内存</th><th>CPU 覆盖进程</th></tr></thead><tbody>{rows.map(user => <tr key={user.uid}><td>{user.username}{user.username === snapshot.username ? '（当前用户）' : ''}{user.isSystem ? ' · 系统' : ''}</td><td>{user.uid}</td><td>{user.processCount}</td><td>{user.cpuUtilization === null ? '—' : `${user.cpuUtilization.toFixed(1)}%`}</td><td>{memory(user.memoryUsedBytes)}</td><td>{snapshot.system.memoryTotalBytes > 0 ? `${(user.memoryUsedBytes / snapshot.system.memoryTotalBytes * 100).toFixed(1)}%` : '—'}</td><td>{user.cpuSampledProcessCount} / {user.processCount}</td></tr>)}</tbody></table></div>
    {!rows.length && <p>本次采样没有此筛选范围内的资源用户。</p>}
    <small>CPU 取两次 /proc 进程计数的增量，100% 表示占满整机全部逻辑核心。只归属两次采样中均可读取、且 PID 未复用的进程；短命进程可能未计入。RSS 含共享页重复计数，合计可能超过物理内存。受 hidepid 等权限限制时，仅统计 SSH 用户可见的进程。数据盘目录占用在下方单独扫描，不阻塞本页实时采样。</small>
  </section>{serverId && <UserStorage serverId={serverId} users={rows} disks={snapshot.disks ?? []} />}</>
}
