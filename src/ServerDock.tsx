import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRightLeft, Download, Cpu, Database, HardDrive, LayoutDashboard, Plus, RefreshCw, Server as ServerIcon, Terminal, Settings2 } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { api } from './services/api'
import { serverdock, type TransferMode } from './services/serverdock'
import { SshImportSheet } from './components/SshImportSheet'
import { ServerForm } from './components/ServerForm'
import { SshTerminal } from './components/SshTerminal'
import type { HostKeyInfo, Project, ProjectSyncProgress, Server, ServerDraft, Snapshot } from './types/models'
import './serverdock.css'

const bytes = (value: number) => value >= 1024 ** 4 ? `${(value / 1024 ** 4).toFixed(1)} TiB` : `${(value / 1024 ** 3).toFixed(1)} GiB`
const percent = (used: number, total: number) => total > 0 ? Math.min(100, Math.max(0, used / total * 100)) : 0
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

function Meter({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return <div className="sd-meter"><div><span>{label}</span><strong>{value.toFixed(1)}%</strong></div><progress aria-label={label} max={100} value={value} /><small>{detail}</small></div>
}

export default function ServerDock() {
  const [servers, setServers] = useState<Server[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [page, setPage] = useState<'overview' | 'transfer'>('overview')
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<'resources' | 'processes' | 'terminal'>('resources')
  const [openedTerminals, setOpenedTerminals] = useState<string[]>([])
  const [form, setForm] = useState<Partial<ServerDraft> | null>(null)
  const [hostKey, setHostKey] = useState<HostKeyInfo | null>(null)
  const [importDrafts, setImportDrafts] = useState<ServerDraft[] | null>(null)
  const [importingConfig, setImportingConfig] = useState(false)
  const importingRef = useRef(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [progress, setProgress] = useState<ProjectSyncProgress[]>([])
  const [mode, setMode] = useState<TransferMode>('direct')
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [transferModes, setTransferModes] = useState<Record<string, TransferMode>>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('serverdock.transferModes') ?? '{}'); return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, mode]) => mode === 'direct' || mode === 'relay')) : {} } catch { return {} }
  })
  useEffect(() => { try { localStorage.setItem('serverdock.transferModes', JSON.stringify(transferModes)) } catch { /* Session choices remain usable when storage is unavailable. */ } }, [transferModes])
  const collecting = useRef(new Set<string>())
  const attempts = useRef<Record<string, number>>({})
  const diskAttempts = useRef<Record<string, number>>({})
  const alive = useRef(true)
  useEffect(() => {
    if (selected && tab === 'terminal' && page === 'overview') setOpenedTerminals(current => current.includes(selected) ? current : [...current, selected])
  }, [selected, tab, page])

  const refreshLists = useCallback(async () => {
    const [next, jobs] = await Promise.all([serverdock.servers(), serverdock.projects()])
    if (!alive.current) return
    setServers(next); setProjects(jobs)
  }, [])

  const importConfig = useCallback(async () => {
    if (importingRef.current) return
    importingRef.current = true; setImportingConfig(true)
    try {
      const drafts = await api.importSshConfig()
      if (!drafts.length) setNotice('已读取 SSH Config，但没有找到可导入的 Host；通配符 Host 会被忽略。')
      else setImportDrafts(drafts)
    } catch (error) { setNotice(`SSH Config 导入失败：${message(error)}`) }
    finally { importingRef.current = false; setImportingConfig(false) }
  }, [])

  const importSelected = async (drafts: ServerDraft[]) => {
    let imported = 0
    try {
      for (const draft of drafts) { await api.saveServer({ ...draft, remoteHistoryEnabled: false }); imported++ }
      setImportDrafts(null); setNotice(`已导入 ${imported} 台服务器`)
    } catch (error) {
      throw new Error(`已导入 ${imported} 台；其余导入失败：${message(error)}。已导入的连接会自动跳过，可重试剩余项。`)
    } finally { await refreshLists() }
  }

  const collect = useCallback(async (server: Server, force = false) => {
    if (collecting.current.has(server.id)) return
    const now = Date.now()
    if (!force && now - (attempts.current[server.id] ?? 0) < Math.max(5, server.samplingIntervalSeconds) * 1000) return
    collecting.current.add(server.id); attempts.current[server.id] = now
    const disks = force || now - (diskAttempts.current[server.id] ?? 0) > 60000
    if (disks) diskAttempts.current[server.id] = now
    try {
      const next = await serverdock.collect(server.id, disks)
      if (!alive.current) return
      setSnapshots(current => ({ ...current, [server.id]: { ...next, disks: disks ? next.disks : current[server.id]?.disks } }))
      setErrors(current => { const copy = { ...current }; delete copy[server.id]; return copy })
    } catch (error) { if (alive.current) setErrors(current => ({ ...current, [server.id]: message(error) })) }
    finally { collecting.current.delete(server.id) }
  }, [])

  useEffect(() => {
    alive.current = true
    void refreshLists().catch(error => setNotice(message(error)))
    return () => { alive.current = false }
  }, [refreshLists])
  useEffect(() => {
    const tick = () => { for (const server of servers) void collect(server) }
    tick(); const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [servers, collect])
  useEffect(() => {
    if (!api.isDesktop) return
    const listener = listen<string>('app-menu-action', ({ payload }) => {
      if (payload === 'menu-add-server') setForm({})
      if (payload === 'menu-view-fleet') { setPage('overview'); setSelected(null) }
      if (payload === 'menu-view-transfers') { setPage('transfer'); setSelected(null) }
      if (payload === 'menu-refresh-all') for (const server of servers) void collect(server, true)
      if (payload === 'menu-about' || payload === 'menu-help-guide' || payload === 'menu-help-project') setNotice('ServerDock · Linux CPU、内存、存储和数据传输工作台 · 基于 RackTop，GPL-3.0。项目主页：https://github.com/JadeiteMind/ServerDock')
      if (payload === 'menu-settings') setNotice('连接配置可在服务器详情中编辑。')
      if (payload === 'menu-import-config') void importConfig()
    })
    void listener.catch(error => setNotice(message(error)))
    return () => { void listener.then(unlisten => unlisten()).catch(() => {}) }
  }, [servers, collect, importConfig])
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try { const items = await api.listProjectSyncProgress(); if (!stopped) setProgress(items) } catch { /* Transfer result reports errors. */ }
    }
    const timer = window.setInterval(() => void tick(), 1000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [])

  const saveServer = async (draft: ServerDraft) => {
    await api.saveServer({ ...draft, remoteHistoryEnabled: false })
    await refreshLists(); setForm(null)
  }
  const verifyHost = async (id: string) => {
    setBusy(true)
    try { setHostKey(await api.scanHostKey(id)) } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }
  const startTransfer = async (project: Project, chosenMode: TransferMode) => {
    const target = project.targets[0]
    if (!target || running) return
    setTransferModes(current => ({ ...current, [project.id]: chosenMode }))
    setRunning(project.id); setNotice('')
    try {
      await serverdock.transfer(project.id, target.serverId, chosenMode)
      setNotice('传输完成，已验证目标。')
    } catch (error) { setNotice(`${message(error)}${chosenMode === 'direct' ? '；可选择本机中转后重试。' : ''}`) }
    finally { setRunning(null); await refreshLists().catch(error => setNotice(message(error))) }
  }
  const submitTransfer = async (event: FormEvent) => {
    event.preventDefault()
    if (sourceId === targetId) { setNotice('请选择两台不同的服务器。'); return }
    if (!api.isDesktop) { setNotice('网页为演示模式。真实文件传输请使用桌面应用。'); return }
    setBusy(true)
    try {
      const project = await api.saveProject({ name: sourcePath.split('/').filter(Boolean).at(-1) ?? '文件传输', kind: 'project', sourceServerId: sourceId, sourcePath, datasetIds: [], modelIds: [], targets: [{ serverId: targetId, path: targetPath }] })
      await refreshLists(); await startTransfer(project, mode)
    } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }

  const server = servers.find(item => item.id === selected)
  const snapshot = selected ? snapshots[selected] : undefined
  const online = servers.filter(item => snapshots[item.id] && !errors[item.id])
  const currentSnapshots = online.map(item => snapshots[item.id])
  const totalMemory = currentSnapshots.reduce((sum, item) => sum + item.system.memoryTotalBytes, 0)
  const usedMemory = currentSnapshots.reduce((sum, item) => sum + item.system.memoryUsedBytes, 0)
  const disks = currentSnapshots.flatMap(item => item.disks ?? [])

  return <div className="sd-app">
    <aside className="sd-sidebar"><div className="sd-brand" data-tauri-drag-region><ServerIcon size={26} /><div>ServerDock<small>LINUX SERVER WORKSPACE</small></div></div>
      <nav aria-label="主导航"><button className={page === 'overview' ? 'active' : ''} onClick={() => { setPage('overview'); setSelected(null) }}><LayoutDashboard size={18} />服务器总览</button><button className={page === 'transfer' ? 'active' : ''} onClick={() => { setPage('transfer'); setSelected(null) }}><ArrowRightLeft size={18} />数据传输</button></nav>
      <div className="sd-sidebar-label">服务器 <span>{servers.length}</span></div>
      <div className="sd-server-list">{servers.map(item => <button key={item.id} className={selected === item.id ? 'active' : ''} onClick={() => { setPage('overview'); setSelected(item.id); setTab('resources') }}><span className={`sd-dot ${errors[item.id] ? 'bad' : snapshots[item.id] ? 'good' : ''}`} />{item.name}</button>)}</div>
      <button disabled={importingConfig} onClick={() => void importConfig()}><Download size={17} />{importingConfig ? '正在读取…' : '导入 SSH Config'}</button><button className="sd-add" onClick={() => setForm({})}><Plus size={17} />添加服务器</button><footer>CPU · 内存 · 存储<br />基于 RackTop · GPL-3.0</footer>
    </aside>
    <main className="sd-main"><header className="sd-topbar"><span data-tauri-drag-region>工作台 / {page === 'transfer' ? '数据传输' : server?.name ?? '服务器总览'}</span><div>{!api.isDesktop && <span className="sd-badge">演示数据</span>}{api.isDesktop && <><button aria-label="最小化" onClick={() => void getCurrentWindow().minimize()}>−</button><button aria-label="最大化或还原" onClick={() => void getCurrentWindow().toggleMaximize()}>□</button><button aria-label="关闭窗口" onClick={() => void getCurrentWindow().close()}>×</button></>}</div></header>
      <div className="sd-content">
      {notice && <div role="status" className="sd-notice"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
      {page === 'transfer' ? <>
        <div className="sd-heading"><div><span className="sd-eyebrow">DATA TRANSFER</span><h1>让数据在服务器之间流动</h1><p>直接传输优先，也可以选择通过这台电脑中转。</p></div><ArrowRightLeft size={32} /></div>
        <form className="sd-panel sd-transfer-form" onSubmit={event => void submitTransfer(event)}><h2>新建传输</h2><div className="sd-transfer-columns">
          <div><label>源服务器<select required value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">选择服务器</option>{servers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>源文件或目录<input required value={sourcePath} onChange={event => setSourcePath(event.target.value)} placeholder="/data/research" /></label></div>
          <ArrowRightLeft size={24} /><div><label>目标服务器<select required value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">选择服务器</option>{servers.filter(item => item.id !== sourceId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>目标完整路径<input required value={targetPath} onChange={event => setTargetPath(event.target.value)} placeholder="/data/research-copy" /></label></div>
        </div><label>传输方式<select value={mode} onChange={event => setMode(event.target.value as TransferMode)}><option value="direct">服务器直接传输</option><option value="relay">本机中转</option></select></label><p>{mode === 'direct' ? '两端需安装 rsync，源服务器须已能使用自己的 SSH 密钥连接目标并信任其指纹。不会复制本机私钥或转发 SSH Agent。目标路径须不存在。' : '两端只需分别能从本机通过 SSH 访问。数据经过本机网络，复用项目同步的冲突检查与断点续传。'}</p><button className="sd-primary" disabled={busy || !!running} type="submit">{busy || running ? '传输处理中…' : '开始传输'}</button></form>
        <section className="sd-panel"><h2>传输记录</h2>{projects.length === 0 && <p>还没有传输任务。</p>}{projects.map(project => { const item = progress.find(item => item.projectId === project.id); const chosenMode = transferModes[project.id] ?? 'direct'; return <div className="sd-job" key={project.id}><div><strong>{project.name}</strong><small>{servers.find(item => item.id === project.sourceServerId)?.name} → {servers.find(item => item.id === project.targets[0]?.serverId)?.name}</small><small>{project.sourcePath} → {project.targets[0]?.path}</small><span>{project.lastError ?? project.targets[0]?.error ?? ({ synced: '已完成', syncing: '传输中', paused: '已暂停', error: '失败' }[project.status as string] ?? '待传输')}</span>{item && <><progress max={Math.max(1, item.totalBytes)} value={item.transferredBytes} /><small>{bytes(item.transferredBytes)} / {bytes(item.totalBytes)} · {item.state}</small></>}</div><div><select aria-label={`${project.name}传输方式`} disabled={!!running} value={chosenMode} onChange={event => setTransferModes(current => ({ ...current, [project.id]: event.target.value as TransferMode }))}><option value="direct">直接传输</option><option value="relay">本机中转</option></select>{running === project.id ? <button onClick={() => void api.cancelProjectSync(project.id, project.targets[0].serverId).catch(error => setNotice(message(error)))}>暂停</button> : <button disabled={!!running} onClick={() => void startTransfer(project, chosenMode)}>重试 / 继续</button>}</div></div> })}</section>
      </> : server ? <>
        <div className="sd-heading"><div><span className="sd-eyebrow">SERVER DETAILS</span><h1>{server.name}</h1><p>{server.username}@{server.host}:{server.port} · {snapshot?.osName ?? '等待采样'}</p></div><div className="sd-actions"><button onClick={() => setForm({ ...server, location: server.location ?? undefined, sshAlias: server.sshAlias ?? undefined, identityFile: server.identityFile ?? undefined, proxyJump: server.proxyJump ?? undefined })}><Settings2 size={16} />编辑</button><button disabled={busy} onClick={() => void verifyHost(server.id)}>核验主机指纹</button><button onClick={() => void collect(server, true)}><RefreshCw size={16} />刷新</button></div></div>
        {errors[server.id] && <div role="alert" className="sd-notice">连接失败：{errors[server.id]}。首次连接请先核验主机指纹。</div>}
        <div className="sd-tabs">{(['resources', 'processes', 'terminal'] as const).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{({ resources: '资源监控', processes: '进程', terminal: 'SSH 终端' })[value]}</button>)}</div>
        {tab === 'resources' && (snapshot ? <><div className="sd-resource-grid"><section className="sd-panel"><Cpu /><h2>CPU</h2><Meter label="CPU 使用率" value={snapshot.system.cpuUtilization} detail={snapshot.system.cpuModel} /><p>负载 1 / 5 / 15 分钟</p><strong>{snapshot.system.load1.toFixed(2)} / {snapshot.system.load5.toFixed(2)} / {snapshot.system.load15.toFixed(2)}</strong></section><section className="sd-panel"><Database /><h2>内存</h2><Meter label="物理内存" value={percent(snapshot.system.memoryUsedBytes, snapshot.system.memoryTotalBytes)} detail={`${bytes(snapshot.system.memoryUsedBytes)} / ${bytes(snapshot.system.memoryTotalBytes)}`} /><Meter label="Swap" value={percent(snapshot.system.swapUsedBytes, snapshot.system.swapTotalBytes)} detail={`${bytes(snapshot.system.swapUsedBytes)} / ${bytes(snapshot.system.swapTotalBytes)}`} /></section></div><section className="sd-panel"><h2><HardDrive size={20} />存储容量</h2>{snapshot.disks?.length ? snapshot.disks.map(disk => <Meter key={disk.mountPoint} label={disk.mountPoint} value={percent(disk.usedBytes, disk.totalBytes)} detail={`已用 ${bytes(disk.usedBytes)} / ${bytes(disk.totalBytes)} · 可用 ${bytes(disk.availableBytes)}`} />) : <p>尚无挂载点数据。</p>}<small>磁盘容量每 60 秒采样；手动刷新可立即更新。</small></section></> : <div className="sd-panel">正在读取服务器资源…</div>)}
        {tab === 'processes' && <section className="sd-panel"><h2>CPU 与内存进程</h2><div className="sd-table-wrap"><table><thead><tr><th>PID</th><th>用户</th><th>CPU</th><th>内存</th><th>运行时间</th><th>命令</th></tr></thead><tbody>{snapshot?.cpuProcesses.map(process => <tr key={process.pid}><td>{process.pid}</td><td>{process.username}</td><td>{process.cpuPercent.toFixed(1)}%</td><td>{bytes(process.memoryUsedBytes)}</td><td>{process.elapsed}</td><td title={process.command}>{process.command}</td></tr>)}</tbody></table></div>{!snapshot?.cpuProcesses.length && <p>尚无进程采样。</p>}<small>CPU 百分比按单个逻辑核心计，可超过 100%。</small></section>}
      </> : <>
        <div className="sd-heading"><div><span className="sd-eyebrow">YOUR INFRASTRUCTURE, AT A GLANCE</span><h1>服务器总览</h1><p>集中掌握每一台服务器的 CPU、内存和存储。</p></div><button className="sd-primary" onClick={() => setForm({})}><Plus size={17} />添加服务器</button></div>
        <section className="sd-panel sd-config-import"><div><strong>从 SSH Config 导入</strong><p>读取本机已有连接，保留 SSH 别名、密钥和跳板机配置。默认读取用户目录下的 .ssh/config。</p></div><div className="sd-actions"><button disabled={importingConfig} onClick={() => void importConfig()}><Download size={16} />{importingConfig ? '正在读取 SSH Config…' : '读取并导入'}</button></div></section>
        <div className="sd-stats"><div><ServerIcon /><small>在线服务器</small><strong>{online.length}<span> / {servers.length}</span></strong></div><div><Cpu /><small>平均 CPU 使用率</small><strong>{(currentSnapshots.reduce((sum, item) => sum + item.system.cpuUtilization, 0) / Math.max(1, online.length)).toFixed(1)}<span>%</span></strong></div><div><Database /><small>内存使用</small><strong>{bytes(usedMemory)}<span> / {bytes(totalMemory)}</span></strong></div><div><HardDrive /><small>已报告挂载点可用容量</small><strong>{bytes(disks.reduce((sum, item) => sum + item.availableBytes, 0))}</strong></div></div>
        <div className="sd-section-heading"><h2>全部服务器</h2><input aria-label="搜索服务器" placeholder="搜索名称、地址或标签…" value={search} onChange={event => setSearch(event.target.value)} /></div><div className="sd-cards">{servers.filter(item => `${item.name} ${item.host} ${item.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).map(item => { const sample = snapshots[item.id]; return <article className="sd-panel sd-card" key={item.id}><button className="sd-card-title" onClick={() => { setSelected(item.id); setTab('resources') }}><ServerIcon size={22} /><strong>{item.name}</strong><span className={`sd-dot ${errors[item.id] ? 'bad' : sample ? 'good' : ''}`} /><small>{errors[item.id] ? '连接失败' : sample ? '在线' : '连接中'}</small></button><p>{item.username}@{item.host}</p>{sample ? <><Meter label="CPU" value={sample.system.cpuUtilization} detail={sample.system.cpuModel} /><Meter label="内存" value={percent(sample.system.memoryUsedBytes, sample.system.memoryTotalBytes)} detail={`${bytes(sample.system.memoryUsedBytes)} / ${bytes(sample.system.memoryTotalBytes)}`} /><Meter label="存储" value={percent((sample.disks ?? []).reduce((sum, disk) => sum + disk.usedBytes, 0), (sample.disks ?? []).reduce((sum, disk) => sum + disk.totalBytes, 0))} detail={`${sample.disks?.length ?? 0} 个已报告挂载点`} /></> : <p>{errors[item.id] ? '打开详情查看错误并核验 SSH 主机指纹。' : '正在读取资源…'}</p>}<div className="sd-card-footer"><span>{sample ? `采样于 ${new Date(sample.timestamp * 1000).toLocaleTimeString()}` : '等待首次采样'}</span><button onClick={() => { setSelected(item.id); setTab('terminal') }}><Terminal size={14} />终端</button></div></article> })}</div>{!servers.length && <div className="sd-panel">添加第一台 Linux 服务器，通过 SSH 开始监控。</div>}
      </>}
      {servers.filter(item => openedTerminals.includes(item.id)).map(item => {
        const active = page === 'overview' && selected === item.id && tab === 'terminal'
        return <div className="sd-terminal" hidden={!active} key={item.id}><SshTerminal serverId={item.id} serverName={item.name} active={active} onNotice={setNotice} /></div>
      })}
      </div>
    </main>
    {importDrafts && <SshImportSheet drafts={importDrafts} servers={servers} onClose={() => setImportDrafts(null)} onImport={importSelected} />}
    {form && <ServerForm cpuOnly initial={form} defaultRemoteHistoryEnabled={false} showGuide={false} onClose={() => setForm(null)} onSave={saveServer} />}
    {hostKey && <div className="sd-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="sd-host-title" className="sd-panel sd-modal"><h2 id="sd-host-title">核验 SSH 主机指纹</h2><p>{hostKey.host} · {hostKey.algorithm}</p><code>{hostKey.fingerprint}</code><p>{hostKey.changed ? '主机指纹已变化。请先向服务器管理员核实原因。' : '请通过服务器控制台或管理员独立确认指纹一致，再信任此主机。'}</p><div className="sd-actions"><button autoFocus onClick={() => setHostKey(null)}>取消</button><button disabled={hostKey.changed || busy} className="sd-primary" onClick={() => { setBusy(true); void api.trustHostKey(hostKey).then(() => { setHostKey(null); const item = servers.find(item => item.id === hostKey.serverId); if (item) void collect(item, true) }).catch(error => setNotice(message(error))).finally(() => setBusy(false)) }}>已核对，信任主机</button></div></section></div>}
  </div>
}
