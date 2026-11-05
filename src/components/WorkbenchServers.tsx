import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { SshTerminal } from './SshTerminal'
import { Trend } from './ResourceHistory'
import type { Snapshot } from '../types/models'

interface Instance { instance_id: string; instance_name: string; status: string; profile: string }
interface Connection extends Instance { region: string }
interface Point { timestamp: number; cpu: number; memory: number; disk: number | null }
type View = 'history' | 'terminal' | 'files'

// Public ECS endpoint IDs. Users can supplement the catalog for their account.
const regions = 'cn-hangzhou cn-shanghai cn-beijing cn-shenzhen cn-guangzhou cn-hongkong cn-qingdao cn-zhangjiakou cn-huhehaote cn-wulanchabu cn-chengdu cn-heyuan cn-wuhan-lr cn-zhongwei cn-zhengzhou-jva ap-northeast-1 ap-northeast-2 ap-southeast-1 ap-southeast-3 ap-southeast-5 ap-southeast-6 ap-southeast-7 ap-southeast-8 ap-south-1 us-west-1 us-east-1 us-southeast-1 eu-central-1 eu-west-1 eu-west-2 eu-west-3 me-east-1 me-central-1 sa-east-1 na-south-1 cn-shenzhen-finance-1 cn-beijing-finance-1 cn-shanghai-finance-1 cn-wulanchabu-gic-1 cn-heyuan-acdr-1 cn-north-2-gov-1'.split(' ')
const key = (item: Connection) => JSON.stringify([item.profile, item.region, item.instance_id])
const historyKey = (item: Connection) => 'serverdock.ecsHistory.' + key(item)
const storageKey = 'serverdock.workbenchInstances'
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1) + ' GiB'
const now = () => Math.floor(Date.now() / 1000)
const name = (item: Connection) => item.instance_name || item.instance_id
const endpoint = (item: Connection) => ({ profile: item.profile, region: item.region, instanceId: item.instance_id })
function readList<T>(id: string): T[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(id) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}
function history(item: Connection) {
  return readList<Point>(historyKey(item)).filter(point => point && point.timestamp >= now() - 86400)
}
function record(item: Connection, sample: Snapshot) {
  const disks = sample.disks ?? []
  const total = disks.reduce((sum, disk) => sum + disk.totalBytes, 0)
  const point: Point = {
    timestamp: sample.timestamp,
    cpu: sample.system.cpuUtilization,
    memory: sample.system.memoryTotalBytes ? sample.system.memoryUsedBytes * 100 / sample.system.memoryTotalBytes : 0,
    disk: total ? disks.reduce((sum, disk) => sum + disk.usedBytes, 0) * 100 / total : null,
  }
  try {
    localStorage.setItem(historyKey(item), JSON.stringify([...history(item).filter(old => old.timestamp < point.timestamp), point].slice(-1440)))
  } catch { /* Live data remains available. */ }
}

function Terminal({ item, username, visible }: { item: Connection; username: string; visible: boolean }) {
  const { profile, region, instanceId } = endpoint(item)
  const startSession = useCallback((columns: number, rows: number) => invoke<string>('start_workbench_terminal', {
    profile, region, instanceId, username, columns, rows,
  }), [profile, region, instanceId, username])
  return <div className="sd-terminal"><SshTerminal serverId={key(item)} serverName={name(item)} startSession={startSession} active={visible} /></div>
}

function InstanceDetails({ item, view, close, visible, busy, setBusy }: { item: Connection; view: View; close: () => void; visible: boolean; busy: boolean; setBusy: (busy: boolean) => void }) {
  const [username, setUsername] = useState('root')
  const [connected, setConnected] = useState(false)
  const [localPath, setLocalPath] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [notice, setNotice] = useState('')
  const points = view === 'history' ? history(item) : []
  const end = now()
  const send = async (upload: boolean) => {
    setBusy(true)
    setNotice(upload ? '正在上传…' : '正在下载…')
    try {
      await invoke('transfer_workbench_file', { ...endpoint(item), username: username.trim(), upload, localPath: localPath.trim(), remotePath: remotePath.trim() })
      setNotice(upload ? '上传完成' : '下载完成')
    } catch (error) { setNotice(String(error)) }
    finally { setBusy(false) }
  }
  return <section className="sd-panel sd-transfer-form">
    <div className="sd-section-heading"><h2>{name(item)} · {view === 'history' ? '历史趋势' : view === 'terminal' ? '远程终端' : '文件传输'}</h2><button disabled={busy} onClick={close}>关闭详情</button></div>
    {view === 'history' ? <>
      <Trend title="CPU 使用率" end={end} points={points.map(point => ({ timestamp: point.timestamp, value: point.cpu }))} />
      <Trend title="内存使用率" end={end} points={points.map(point => ({ timestamp: point.timestamp, value: point.memory }))} />
      <Trend title="存储使用率" end={end} points={points.flatMap(point => point.disk == null ? [] : [{ timestamp: point.timestamp, value: point.disk }])} />
    </> : <>
      <label>远端登录用户<input disabled={busy || connected} value={username} onChange={event => setUsername(event.target.value)} /></label>
      {view === 'terminal' ? connected
        ? <Terminal item={item} username={username.trim()} visible={visible} />
        : <button disabled={!username.trim()} onClick={() => setConnected(true)}>连接终端</button>
      : <>
        <p>经 Workbench 中转单个文件。两端均填写包含文件名的绝对路径。</p>
        <label>本机文件路径<input disabled={busy} value={localPath} onChange={event => setLocalPath(event.target.value)} /></label>
        <label>远端文件路径<input disabled={busy} value={remotePath} onChange={event => setRemotePath(event.target.value)} /></label>
        <div className="sd-actions">
          <button disabled={busy || !username.trim() || !localPath.trim() || !remotePath.trim()} onClick={() => void send(true)}>上传到 ECS</button>
          <button disabled={busy || !username.trim() || !localPath.trim() || !remotePath.trim()} onClick={() => void send(false)}>下载到本机</button>
        </div>
        {notice && <p role="status">{notice}</p>}
      </>}
    </>}
  </section>
}

export function WorkbenchServers({ visible }: { visible: boolean }) {
  const [instances, setInstances] = useState(() => readList<Connection>(storageKey))
  const [profile, setProfile] = useState('')
  const [profiles, setProfiles] = useState<string[]>([])
  const [extraRegions, setExtraRegions] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [failures, setFailures] = useState<{ region: string; error: string }[]>([])
  const [completed, setCompleted] = useState(0)
  const [total, setTotal] = useState(0)
  const [samples, setSamples] = useState<Record<string, Snapshot>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [transferBusy, setTransferBusy] = useState(false)
  const [selection, setSelection] = useState<{ id: string; view: View } | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    void invoke<{ current: string; names: string[] }>('workbench_profiles').then(result => {
      if (active) { setProfiles(result.names); setProfile(result.current ?? '') }
    }).catch(error => { if (active) setNotice(String(error)) })
    return () => { active = false }
  }, [])

  const remember = (next: Connection[]) => {
    localStorage.setItem(storageKey, JSON.stringify(next))
    setInstances(next)
  }

  const importRegions = async (targets: string[]) => {
    if (busy || !profile || !targets.length) return
    setBusy(true)
    setNotice('')
    setFailures([])
    setTotal(targets.length)
    setCompleted(0)
    const failed: { region: string; error: string }[] = []
    const merged = new Map(instances.map(item => [key(item), item]))
    const pending = targets.values()
    try {
      await Promise.all(Array.from({ length: Math.min(5, targets.length) }, async () => {
        for (const region of pending) {
          try {
            const found = await invoke<Instance[]>('list_workbench_instances', { profile, region })
            for (const item of found) {
              const connection = { ...item, region }
              merged.set(key(connection), connection)
            }
          } catch (error) { failed.push({ region, error: String(error) }) }
          finally { setCompleted(current => current + 1) }
        }
      }))
      remember([...merged.values()])
      setNotice(`已查询 ${targets.length} 个地域，新增 ${merged.size - instances.length} 台，${failed.length} 个地域查询失败。`)
    } catch (error) { setNotice(String(error)) }
    finally { setFailures(failed); setBusy(false) }
  }

  useEffect(() => {
    if (!instances.length) return
    let stopped = false
    let running = false
    const sample = async () => {
      if (running) return
      running = true
      try {
        const pending = instances.filter(item => item.status.toLowerCase() === 'running').values()
        await Promise.all(Array.from({ length: 2 }, async () => {
          for (const item of pending) {
            if (stopped) return
            const id = key(item)
            try {
              const value = await invoke<Snapshot>('collect_workbench_instance', endpoint(item))
              if (stopped) return
              record(item, value)
              setSamples(current => ({ ...current, [id]: value }))
              setErrors(current => { const next = { ...current }; delete next[id]; return next })
            } catch (error) {
              if (!stopped) setErrors(current => ({ ...current, [id]: String(error) }))
            }
          }
        }))
      } finally { running = false }
    }
    void sample()
    const timer = window.setInterval(() => void sample(), 60000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [instances, refresh])

  const grouped = new Map<string, Connection[]>()
  for (const item of instances) {
    const group = grouped.get(item.region) ?? []
    group.push(item)
    grouped.set(item.region, group)
  }
  const active = instances.find(item => key(item) === selection?.id)
  const extra = extraRegions.split(/[\s,，]+/).filter(Boolean)
  const targets = [...new Set([...regions, ...instances.map(item => item.region), ...extra])]
  const open = (item: Connection, view: View) => setSelection({ id: key(item), view })
  const remove = (item: Connection) => {
    if (!window.confirm('从 VPS 分组移除此连接？')) return
    const id = key(item)
    try {
      remember(instances.filter(connection => key(connection) !== id))
      localStorage.removeItem(historyKey(item))
      if (selection?.id === id) setSelection(null)
    } catch (error) { setNotice(String(error)) }
  }

  return <>
    <div className="sd-heading"><div><h1>VPS / 阿里云 ECS</h1><p>按地域查看由 Workbench 管理的 Linux 实例。</p></div></div>
    <form className="sd-panel sd-transfer-form" onSubmit={event => { event.preventDefault(); void importRegions(targets) }}>
      <h2>一键导入阿里云 ECS</h2>
      <label>Workbench Profile<select disabled={busy} value={profile} onChange={event => { setProfile(event.target.value); setFailures([]) }}>
        <option value="">选择已配置的 Profile</option>
        {profiles.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>补充地域（可选）<input disabled={busy} value={extraRegions} onChange={event => setExtraRegions(event.target.value)} placeholder="多个地域 ID 用空格分隔" /></label>
      <div className="sd-actions">
        <button className="sd-primary" disabled={busy || !profile}>{busy ? `查询中 ${completed} / ${total}` : '一键导入各地域'}</button>
        <button type="button" disabled={busy || !profile || !extra.length} onClick={() => void importRegions([...new Set(extra)])}>仅查询填写的地域</button>
        <button type="button" disabled={busy || !instances.length} onClick={() => setRefresh(current => current + 1)}>刷新监控</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {!!failures.length && <details><summary>查看失败地域（{failures.length}）</summary>
        <ul>{failures.map(item => <li key={item.region}>{item.region} · {item.error}</li>)}</ul>
        <button type="button" disabled={busy} onClick={() => void importRegions(failures.map(item => item.region))}>重试失败地域</button>
      </details>}
    </form>
    {active && selection && <InstanceDetails key={selection.id + selection.view} item={active} view={selection.view} visible={visible} busy={transferBusy} setBusy={setTransferBusy} close={() => setSelection(null)} />}
    {[...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([region, items]) => <section key={region}>
      <div className="sd-section-heading"><h2>{region} · {items.length} 台</h2></div>
      <div className="sd-cards">{items.map(item => {
        const id = key(item)
        const value = samples[id]
        const running = item.status.toLowerCase() === 'running'
        return <section className="sd-panel" key={id}>
          <h2>{name(item)}</h2>
          <p>{item.instance_id} · {item.profile}</p>
          <p>{running ? '运行中' : item.status} {value && '· 采样于 ' + new Date(value.timestamp * 1000).toLocaleTimeString()}</p>
          {errors[id] && <p role="alert">采集失败：{errors[id]}</p>}
          {value && <><p>CPU {value.system.cpuUtilization.toFixed(1)}% · 内存 {gib(value.system.memoryUsedBytes)} / {gib(value.system.memoryTotalBytes)}</p>
            {value.disks?.map(disk => <p key={disk.mountPoint}>{disk.mountPoint} · {gib(disk.usedBytes)} / {gib(disk.totalBytes)}</p>)}</>}
          <div className="sd-actions">
            <button disabled={transferBusy} onClick={() => open(item, 'history')}>历史趋势</button>
            <button disabled={!running || transferBusy} onClick={() => open(item, 'terminal')}>远程终端</button>
            <button disabled={!running || transferBusy} onClick={() => open(item, 'files')}>文件传输</button>
            <button disabled={busy || transferBusy} onClick={() => remove(item)}>移除连接</button>
          </div>
        </section>
      })}</div>
    </section>)}
  </>
}
