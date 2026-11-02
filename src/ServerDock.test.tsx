// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ServerDock from './ServerDock'
import { api } from './services/api'
import { serverdock } from './services/serverdock'
import { ServerForm } from './components/ServerForm'
import type { Project, Server, Snapshot } from './types/models'

vi.mock('./components/SshTerminal', () => ({ SshTerminal: () => <div>terminal</div> }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('./services/api', () => ({ api: { isDesktop: true, listProjectSyncProgress: vi.fn(async () => []), saveProject: vi.fn(), cancelProjectSync: vi.fn() } }))
vi.mock('./services/serverdock', () => ({ serverdock: { servers: vi.fn(), projects: vi.fn(), collect: vi.fn(), transfer: vi.fn() } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const servers = [{ id: 'a', name: 'compute', host: 'a.local', username: 'user', tags: [], port: 22, samplingIntervalSeconds: 5, historyRetentionDays: 90, remoteHistoryEnabled: false, authMethod: 'sshAgent', status: 'unknown' }, { id: 'b', name: 'archive', host: 'b.local', username: 'user', tags: [], port: 22, samplingIntervalSeconds: 5, historyRetentionDays: 90, remoteHistoryEnabled: false, authMethod: 'sshAgent', status: 'unknown' }] as Server[]
const project = { id: 'job', name: 'research', sourceServerId: 'a', sourcePath: '/data/research', targets: [{ serverId: 'b', path: '/data/copy' }], status: 'error' } as Project
const sample = { timestamp: 100, osName: 'Linux', system: { cpuUtilization: 35, cpuModel: 'Xeon', memoryUsedBytes: 16 * 1024 ** 3, memoryTotalBytes: 64 * 1024 ** 3, swapUsedBytes: 0, swapTotalBytes: 0, load1: 1, load5: 2, load15: 3 }, disks: [{ mountPoint: '/data', usedBytes: 10, totalBytes: 100, availableBytes: 90 }], cpuProcesses: [] } as unknown as Snapshot
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve() })
const button = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent === text)!
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  vi.mocked(serverdock.servers).mockResolvedValue(servers)
  vi.mocked(serverdock.projects).mockResolvedValue([])
  vi.mocked(serverdock.collect).mockResolvedValue(sample)
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('ServerDock CPU workspace', () => {
  it('keeps an opened terminal mounted while navigating away and back', async () => {
    await act(async () => root.render(<ServerDock />)); await flush()
    act(() => button('compute').click()); await flush()
    act(() => button('SSH 终端').click()); await flush()
    const terminal = container.querySelector('.sd-terminal')
    expect(terminal).not.toBeNull()
    expect(terminal?.hasAttribute('hidden')).toBe(false)
    act(() => button('服务器总览').click()); await flush()
    expect(terminal?.hasAttribute('hidden')).toBe(true)
    act(() => button('compute').click()); await flush()
    act(() => button('SSH 终端').click()); await flush()
    expect(container.querySelector('.sd-terminal')).toBe(terminal)
    expect(terminal?.hasAttribute('hidden')).toBe(false)
  })
  it('allows an existing SSH Agent configuration without upstream key installation', async () => {
    const save = vi.fn(async () => {})
    await act(async () => root.render(<ServerForm cpuOnly showGuide={false} initial={{ name: 'cpu', host: 'cpu.local', username: 'user' }} onClose={vi.fn()} onSave={save} />))
    expect(button('保存并连接').disabled).toBe(false)
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ authMethod: 'sshAgent', host: 'cpu.local' }))
    expect(container.textContent).not.toContain('服务器远端缓存')
  })
  it('shows CPU, memory and storage without accelerator navigation', async () => {
    await act(async () => root.render(<ServerDock />)); await flush()
    expect(container.textContent).toContain('35.0%')
    expect(container.textContent).not.toMatch(/GPU|显存|训练|空闲算力/)
    act(() => button('compute').click()); await flush()
    expect(container.textContent).toContain('负载 1 / 5 / 15 分钟')
    expect(container.textContent).toContain('/data')
    expect(container.textContent).toContain('16.0 GiB / 64.0 GiB')
  })
  it('does not silently relay on direct failure and permits explicit relay retry', async () => {
    vi.mocked(serverdock.projects).mockResolvedValue([project])
    vi.mocked(serverdock.transfer).mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValueOnce(undefined)
    await act(async () => root.render(<ServerDock />)); await flush()
    act(() => button('数据传输').click()); await flush()
    await act(async () => button('重试 / 继续').click()); await flush()
    expect(serverdock.transfer).toHaveBeenCalledTimes(1)
    expect(serverdock.transfer).toHaveBeenLastCalledWith('job', 'b', 'direct')
    expect(container.textContent).toContain('Permission denied')
    const select = container.querySelector<HTMLSelectElement>('[aria-label="research传输方式"]')!
    act(() => { select.value = 'relay'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => button('重试 / 继续').click()); await flush()
    expect(serverdock.transfer).toHaveBeenLastCalledWith('job', 'b', 'relay')
    expect(container.textContent).toContain('传输完成')
    expect(api.cancelProjectSync).not.toHaveBeenCalled()
  })
  it('reports connection failure without counting stale resources as online', async () => {
    vi.mocked(serverdock.collect).mockRejectedValue(new Error('Host key verification failed'))
    await act(async () => root.render(<ServerDock />)); await flush()
    expect(container.querySelector('.sd-stats')?.textContent).toContain('0 / 2')
    act(() => button('compute').click()); await flush()
    expect(container.textContent).toContain('Host key verification failed')
  })
})
