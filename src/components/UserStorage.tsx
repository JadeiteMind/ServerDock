import { useEffect, useRef, useState } from 'react'
import { userStorage, uniqueStorageEntries, type StorageTarget, type StorageScan } from '../services/userStorage'
import type { DiskMetric, UserResourceMetric } from '../types/models'

interface PathChoice extends StorageTarget { enabled: boolean }
const bytes = (value: number) => value >= 1024 ** 4 ? `${(value / 1024 ** 4).toFixed(2)} TiB` : `${(value / 1024 ** 3).toFixed(2)} GiB`
const reason: Record<string, string> = { pending: '等待扫描', scanning: '扫描中', success: '已完成', timeout: '超时', permissionDenied: '权限不足', missing: '目录不存在或不可访问', failed: '统计失败', overlap: '已包含在上级目录中', cancelled: '已取消' }
const keyOf = (path: StorageTarget) => `${path.uid}:${path.path}`

export function UserStorage({ serverId, users, disks }: { serverId: string; users: UserResourceMetric[]; disks: DiskMetric[] }) {
  const [paths, setPaths] = useState<PathChoice[]>([])
  const [scan, setScan] = useState<StorageScan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uid, setUid] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const automaticAttempt = useRef(false)
  const usersKey = JSON.stringify(users.map(user => ({ uid: user.uid, username: user.username })).sort((a, b) => a.uid - b.uid))
  const mountsKey = JSON.stringify(disks.map(disk => disk.mountPoint).sort())
  const storageKey = `serverdock.userStoragePaths.${serverId}`

  const remember = (choices: PathChoice[]) => {
    setPaths(choices)
    try { localStorage.setItem(storageKey, JSON.stringify(choices)) } catch { setError('目录配置未能保存到本机；本次仍可统计。') }
  }
  useEffect(() => {
    let stopped = false
    automaticAttempt.current = false; setLoaded(false); setPaths([]); setScan(null); setLoading(true); setError('')
    const load = async () => {
      let saved: PathChoice[] | null = null
      try {
        const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
        if (Array.isArray(value)) saved = value.filter(item => item && Number.isInteger(item.uid) && typeof item.username === 'string' && typeof item.path === 'string' && typeof item.enabled === 'boolean')
      } catch { /* A damaged local preference must not prevent discovery. */ }
      const state = await userStorage.get(serverId)
      const candidates = saved ?? (await userStorage.discover(serverId, JSON.parse(usersKey), JSON.parse(mountsKey))).map(target => ({ ...target, enabled: true }))
      if (!stopped) { setPaths(candidates); setScan(state); setLoaded(true) }
    }
    void load().catch(error => { if (!stopped) { setError(String(error)); setLoaded(true) } }).finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [serverId, storageKey, usersKey, mountsKey])

  const accounts = [...new Map([...users.map(user => ({ uid: user.uid, username: user.username })), ...paths.map(path => ({ uid: path.uid, username: path.username }))].map(user => [user.uid, user])).values()]
  const selected = paths.filter(path => path.enabled)
  const start = async () => {
    if (saving || scan?.running || !selected.length) return
    setSaving(true); setError('')
    try { setScan(await userStorage.start(serverId, selected.map(({ uid, username, path }) => ({ uid, username, path })))) } catch (error) { setError(String(error)) } finally { setSaving(false) }
  }
  useEffect(() => {
    if (!loaded || automaticAttempt.current || !selected.length || scan?.running) return
    automaticAttempt.current = true
    if (!scan || Date.now() / 1000 - (scan.finishedAt ?? scan.startedAt) > 600) void start()
  }, [loaded, paths, scan])
  useEffect(() => {
    if (!scan?.running) return
    let stopped = false; let inFlight = false
    const timer = window.setInterval(async () => {
      if (inFlight) return
      inFlight = true
      try { const next = await userStorage.get(serverId); if (!stopped) setScan(next) } catch (error) { if (!stopped) setError(String(error)) } finally { inFlight = false }
    }, 1000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [serverId, scan?.running])

  const discover = async () => {
    if (loading || scan?.running) return
    setLoading(true); setError('')
    try {
      const found = await userStorage.discover(serverId, JSON.parse(usersKey), JSON.parse(mountsKey))
      const known = new Set(paths.map(keyOf))
      remember([...paths, ...found.filter(path => !known.has(keyOf(path))).map(path => ({ ...path, enabled: true }))])
    } catch (error) { setError(String(error)) } finally { setLoading(false) }
  }
  const add = () => {
    const user = accounts.find(user => String(user.uid) === uid) ?? accounts[0]
    const path = pathInput.trim().replace(/\/+$/, '')
    if (!user || !path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)) { setError('请输入非根目录的绝对路径，例如 /mnt/data1/用户名。'); return }
    const target = { uid: user.uid, username: user.username, path, enabled: true }
    if (paths.some(item => keyOf(item) === keyOf(target))) { setError('此用户的目录已在列表中。'); return }
    remember([...paths, target]); setPathInput(''); setError('')
  }
  const entries = (scan?.entries ?? []).filter(entry => selected.some(path => keyOf(path) === keyOf(entry)))

  return <section className="sd-panel sd-user-storage"><div className="sd-section-heading"><h2>用户数据盘目录占用</h2><div className="sd-actions"><button disabled={loading || scan?.running} onClick={() => void discover()}>{loading ? '正在发现…' : '发现数据盘目录'}</button>{scan?.running ? <button onClick={() => void userStorage.cancel(serverId).catch(error => setError(String(error)))}>取消统计</button> : <button className="sd-primary" disabled={saving || !selected.length} onClick={() => void start()}>{saving ? '正在启动…' : '刷新目录占用'}</button>}</div></div>
    <p>按本机挂载点及 /mnt/data*、/data* 查找“数据盘 / 用户名”目录。同时检查本机普通账号对应目录，包含当前无进程的账号。各服务器分别配置和保存；也可添加该机的其他实际路径。按目录归属统计，不按文件 UID 计费。</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="sd-storage-add"><label>归属用户<select value={uid || String(accounts[0]?.uid ?? '')} onChange={event => setUid(event.target.value)}>{accounts.map(user => <option key={user.uid} value={user.uid}>{user.username}</option>)}</select></label><label>数据目录<input value={pathInput} onChange={event => setPathInput(event.target.value)} placeholder="/mnt/data1/用户名" /></label><button disabled={loading || scan?.running || !accounts.length} onClick={add}>添加目录</button></div>
    {scan?.running && <p role="status">{scan.queued ? '等待扫描槽位…' : `后台扫描中：${scan.entries.filter(entry => entry.status !== 'pending' && entry.status !== 'scanning').length} / ${scan.entries.length} 个目录`}。CPU 和内存采样继续运行。</p>}
    {!loading && !paths.length && <p>没有自动发现可访问的同名用户目录。可手动添加数据盘路径；不会将未发现的目录当成零占用。</p>}
    <div className="sd-storage-totals">{accounts.map(user => { const known = uniqueStorageEntries(entries, user.uid); return <div key={user.uid}><strong>{user.username}</strong><span>{known.length ? bytes(known.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)) : '—'}</span><small>已知占用 · {known.length} 个独立目录 · 可能含上次成功缓存</small></div> })}</div>
    <div className="sd-table-wrap"><table><thead><tr><th>统计</th><th>用户</th><th>数据目录</th><th>占用</th><th>状态 / 统计时间</th><th>配置</th></tr></thead><tbody>{paths.map(path => { const result = scan?.entries.find(entry => keyOf(entry) === keyOf(path)); return <tr key={keyOf(path)}><td><input type="checkbox" aria-label={`统计 ${path.username} ${path.path}`} disabled={scan?.running} checked={path.enabled} onChange={event => remember(paths.map(item => keyOf(item) === keyOf(path) ? { ...item, enabled: event.target.checked } : item))} /></td><td>{path.username}</td><td className="sd-path-cell" title={result?.canonicalPath ?? path.path}>{path.path}</td><td>{result?.bytes != null ? bytes(result.bytes) : '—'}{result?.status !== 'success' && result?.bytes != null ? '（缓存）' : ''}</td><td title={result?.error ?? ''}>{result ? reason[result.status] ?? result.status : '未统计'}<small>{result?.checkedAt ? new Date(result.checkedAt * 1000).toLocaleString() : ''}</small>{result?.error && <small>{result.error}</small>}</td><td><button disabled={scan?.running} onClick={() => remember(paths.filter(item => keyOf(item) !== keyOf(path)))}>移除路径</button></td></tr> })}</tbody></table></div>
    <small>采用低优先级 du 统计磁盘分配空间，每个目录最多扫描 60 秒；默认打开时自动扫描无缓存或超过 10 分钟的配置。-x 不跨入子挂载点，符号链接解析到实际目录；同一用户的相同或嵌套目录只计一次。不同用户配置共享目录时可能重复归属。权限不足、超时、取消会明确显示，并保留上次成功结果；不会运行 sudo。“移除路径”只修改本机统计配置，不删除服务器文件。</small>
  </section>
}
