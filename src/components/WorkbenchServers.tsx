import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { api } from '../services/api'
import type { Snapshot } from '../types/models'

interface Instance {
  instance_id: string
  instance_name: string
  status: string
  os_type: string
  profile: string
}
interface Connection extends Instance { region: string }

const key = (item: Connection) => JSON.stringify([item.profile, item.region, item.instance_id])
const storageKey = 'serverdock.workbenchInstances'
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1) + ' GiB'

export function WorkbenchServers() {
  const [instances, setInstances] = useState<Connection[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') } catch { return [] }
  })
  const [profile, setProfile] = useState('')
  const [region, setRegion] = useState('cn-hangzhou')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [samples, setSamples] = useState<Record<string, Snapshot>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const remember = (next: Connection[]) => {
    localStorage.setItem(storageKey, JSON.stringify(next))
    setInstances(next)
  }

  const importRegion = async () => {
    setBusy(true)
    setNotice('')
    try {
      const found = await invoke<Instance[]>('list_workbench_instances', { profile: profile.trim(), region: region.trim() })
      const merged = new Map(instances.map(item => [key(item), item]))
      for (const item of found) {
        const connection = { ...item, region: region.trim() }
        merged.set(key(connection), connection)
      }
      remember([...merged.values()])
      setNotice('已同步 ' + found.length + ' 台 Linux ECS，新增 ' + (merged.size - instances.length) + ' 台。')
    } catch (error) { setNotice(String(error)) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (!api.isDesktop || !instances.length) return
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
              const value = await invoke<Snapshot>('collect_workbench_instance', { profile: item.profile, region: item.region, instanceId: item.instance_id })
              if (stopped) return
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
  }, [instances])

  return <>
    <div className="sd-heading"><div><h1>VPS / 阿里云 ECS</h1><p>通过本机 Workbench 连接和采集，可管理无公网 IP 的 Linux ECS。</p></div></div>
    <form className="sd-panel sd-transfer-form" onSubmit={event => { event.preventDefault(); void importRegion() }}>
      <h2>导入阿里云 ECS</h2>
      <label>Workbench Profile<input value={profile} onChange={event => setProfile(event.target.value)} placeholder="留空使用当前 Profile" /></label>
      <label>地域<input required value={region} onChange={event => setRegion(event.target.value)} placeholder="cn-hangzhou" /></label>
      <button className="sd-primary" disabled={busy || !api.isDesktop || !region.trim()}>{busy ? '正在查询…' : '导入该地域的 Linux ECS'}</button>
      {notice && <p role="status">{notice}</p>}
    </form>
    <div className="sd-cards">{instances.map(item => {
      const id = key(item)
      const value = samples[id]
      return <section className="sd-panel" key={id}>
        <h2>{item.instance_name || item.instance_id}</h2>
        <p>{item.region} · {item.instance_id}</p>
        <p>{item.status.toLowerCase() === 'running' ? '运行中' : item.status} {value && '· 采样于 ' + new Date(value.timestamp * 1000).toLocaleTimeString()}</p>
        {errors[id] && <p role="alert">采集失败：{errors[id]}</p>}
        {value && <><p>CPU {value.system.cpuUtilization.toFixed(1)}% · 内存 {gib(value.system.memoryUsedBytes)} / {gib(value.system.memoryTotalBytes)}</p>
          {value.disks?.map(disk => <p key={disk.mountPoint}>{disk.mountPoint} · {gib(disk.usedBytes)} / {gib(disk.totalBytes)}</p>)}</>}
        <button disabled={busy} onClick={() => {
          if (!window.confirm('从 VPS 分组移除此连接？')) return
          try { remember(instances.filter(connection => key(connection) !== id)) } catch (error) { setNotice(String(error)) }
        }}>移除连接</button>
      </section>
    })}</div>
  </>
}
