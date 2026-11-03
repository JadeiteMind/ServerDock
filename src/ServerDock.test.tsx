// @vitest-environment jsdom
import { act } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ServerDock from './ServerDock'
import { api } from './services/api'
import { serverdock } from './services/serverdock'
import { ServerForm } from './components/ServerForm'
import type { Project, Server, Snapshot } from './types/models'

const windowMocks = vi.hoisted(() => ({ startDragging: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), minimize: vi.fn(async () => {}), close: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => windowMocks }))
vi.mock('./components/SshTerminal', () => ({ SshTerminal: () => <div>terminal</div> }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('./services/api', () => ({ api: { isDesktop: true, listProjectSyncProgress: vi.fn(async () => []), saveProject: vi.fn(), cancelProjectSync: vi.fn(), importSshConfig: vi.fn(), saveServer: vi.fn() } }))
vi.mock('./services/serverdock', () => ({ serverdock: { servers: vi.fn(), projects: vi.fn(), collect: vi.fn(), transfer: vi.fn() } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const servers = [{ id: 'a', name: 'compute', host: 'a.local', username: 'user', tags: [], port: 22, samplingIntervalSeconds: 5, historyRetentionDays: 90, remoteHistoryEnabled: false, authMethod: 'sshAgent', status: 'unknown' }, { id: 'b', name: 'archive', host: 'b.local', username: 'user', tags: [], port: 22, samplingIntervalSeconds: 5, historyRetentionDays: 90, remoteHistoryEnabled: false, authMethod: 'sshAgent', status: 'unknown' }] as Server[]
const project = { id: 'job', name: 'research', sourceServerId: 'a', sourcePath: '/data/research', targets: [{ serverId: 'b', path: '/data/copy' }], status: 'error' } as Project
const sample = { timestamp: 100, osName: 'Linux', system: { cpuUtilization: 35, cpuModel: 'Xeon', memoryUsedBytes: 16 * 1024 ** 3, memoryTotalBytes: 64 * 1024 ** 3, swapUsedBytes: 0, swapTotalBytes: 0, load1: 1, load5: 2, load15: 3 }, disks: [{ mountPoint: '/data', usedBytes: 10 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, availableBytes: 90 * 1024 ** 3 }], cpuProcesses: [] } as unknown as Snapshot
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
  it('drags from titlebar whitespace and nested branding without intercepting controls', async () => {
    await act(async () => root.render(<ServerDock />)); await flush()
    const header = container.querySelector('.sd-topbar')!
    act(() => header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 })))
    expect(windowMocks.startDragging).toHaveBeenCalledTimes(1)
    act(() => container.querySelector('.sd-brand small')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 })))
    expect(windowMocks.startDragging).toHaveBeenCalledTimes(2)
    act(() => container.querySelector('[aria-label="最小化"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 })))
    expect(windowMocks.startDragging).toHaveBeenCalledTimes(2)
    act(() => header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0, detail: 2 })))
    expect(windowMocks.toggleMaximize).toHaveBeenCalledTimes(1)
  })
  it('publishes fleet resource and failure summaries to the tray', async () => {
    vi.mocked(serverdock.collect).mockImplementation(async id => { if (id === 'b') throw new Error('offline'); return sample })
    await act(async () => root.render(<ServerDock />)); await flush()
    expect(invoke).toHaveBeenLastCalledWith('update_serverdock_tray', { summary: expect.stringContaining('1 / 2 台在线 · 1 台连接失败\n平均 CPU 35.0% · 内存 25.0%') })
  })
  it('shows used and total storage in the fleet and server card', async () => {
    await act(async () => root.render(<ServerDock />)); await flush()
    expect(container.querySelector('.sd-capacity')?.textContent).toContain('20.0 GiB / 200.0 GiB')
    expect(container.querySelector('.sd-card')?.textContent).toContain('10.0 GiB / 100.0 GiB')
  })
  it('opens the independently sampled user-resource tab', async () => {
    vi.mocked(serverdock.collect).mockResolvedValue({ ...sample, userResourcesSampled: true, userResources: [{ uid: 1000, username: 'alice', processCount: 180, cpuUtilization: 22, cpuSampledProcessCount: 175, memoryUsedBytes: 1024 ** 3, isSystem: false }] })
    await act(async () => root.render(<ServerDock />)); await flush()
    act(() => button('compute').click()); await flush()
    act(() => button('用户资源').click()); await flush()
    expect(container.querySelector('.sd-users')?.textContent).toContain('alice')
    expect(container.querySelector('.sd-users')?.textContent).toContain('180')
    expect(container.querySelector('.sd-users')?.textContent).toContain('22.0%')
  })
  it('imports config aliases in bulk and skips existing connection targets', async () => {
    const fresh = { name: 'cpu-node', host: 'new.local', port: 2222, username: 'alice', authMethod: 'sshConfig', sshAlias: 'cpu-node', identityFile: '~/.ssh/lab_key', proxyJump: 'bastion', tags: [], samplingIntervalSeconds: 2, historyRetentionDays: 90, remoteHistoryEnabled: false } as const
    const draft = { ...fresh, tags: [] }
    vi.mocked(api.importSshConfig).mockResolvedValue([{ ...draft, name: servers[0].name, host: servers[0].host, port: servers[0].port, username: servers[0].username, sshAlias: 'existing' }, draft])
    vi.mocked(api.saveServer).mockResolvedValue({ ...draft, id: 'new', status: 'unknown' })
    await act(async () => root.render(<ServerDock />)); await flush()
    await act(async () => button('导入 SSH Config').click()); await flush()
    expect(api.importSshConfig).toHaveBeenCalledWith()
    expect(container.textContent).toContain('跳过 1 台重复服务器')
    const duplicate = container.querySelector<HTMLInputElement>('.import-row--duplicate input')!
    expect(duplicate.disabled).toBe(true)
    await act(async () => button('导入 1 台').click()); await flush()
    expect(api.saveServer).toHaveBeenCalledTimes(1)
    expect(api.saveServer).toHaveBeenCalledWith(expect.objectContaining({ sshAlias: 'cpu-node', identityFile: '~/.ssh/lab_key', proxyJump: 'bastion', port: 2222, authMethod: 'sshConfig', remoteHistoryEnabled: false }))
    expect(container.textContent).toContain('已导入 1 台服务器')
  })
  it('keeps remaining imports retryable after a partial save failure', async () => {
    const draft = { name: 'one', host: 'one.local', port: 22, username: 'user', authMethod: 'sshConfig', tags: [], samplingIntervalSeconds: 2, historyRetentionDays: 90, remoteHistoryEnabled: false } as import('./types/models').ServerDraft
    const second = { ...draft, name: 'two', host: 'two.local' }
    const saved = { ...draft, id: 'new', status: 'unknown' } as Server
    vi.mocked(api.importSshConfig).mockResolvedValue([draft, second])
    vi.mocked(api.saveServer).mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('写入失败')).mockResolvedValueOnce({ ...second, id: 'two', status: 'unknown' })
    vi.mocked(serverdock.servers).mockResolvedValueOnce(servers).mockResolvedValue([...servers, saved])
    await act(async () => root.render(<ServerDock />)); await flush()
    await act(async () => button('导入 SSH Config').click()); await flush()
    await act(async () => button('导入 2 台').click()); await flush()
    expect(container.textContent).toContain('已导入 1 台；其余导入失败')
    await act(async () => button('导入 1 台').click()); await flush()
    expect(api.saveServer).toHaveBeenCalledTimes(3)
    expect(api.saveServer).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'two.local' }))
  })
  it('reports config read errors and empty config results', async () => {
    vi.mocked(api.importSshConfig).mockRejectedValueOnce(new Error('文件不存在')).mockResolvedValueOnce([])
    await act(async () => root.render(<ServerDock />)); await flush()
    await act(async () => button('读取并导入').click()); await flush()
    expect(container.textContent).toContain('文件不存在')
    await act(async () => button('读取并导入').click()); await flush()
    expect(container.textContent).toContain('没有找到可导入的 Host')
  })
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
