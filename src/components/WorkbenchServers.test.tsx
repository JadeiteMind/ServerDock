// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { expect, it, vi } from 'vitest'
import { WorkbenchServers } from './WorkbenchServers'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./SshTerminal', () => ({ SshTerminal: () => null }))

it('imports across regions, groups results and retries only failed regions without duplicates', async () => {
  let retrying = false
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'workbench_profiles') return { current: 'default', names: ['default'] }
    const region = (args as { region: string }).region
    if (region === 'cn-shanghai' && !retrying) throw new Error('地域暂时不可用')
    if (region === 'cn-hangzhou' || region === 'cn-shanghai') return [
      { instance_id: 'i-example', instance_name: 'example', profile: 'default', status: 'Stopped' },
    ]
    return []
  })
  const rootNode = document.createElement('div')
  document.body.append(rootNode)
  const root = createRoot(rootNode)
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => root.render(<WorkbenchServers visible />))
    const click = async (label: string) => {
      const button = [...rootNode.querySelectorAll('button')].find(item => item.textContent === label)!
      await act(async () => button.click())
    }
    await click('一键导入各地域')
    expect(rootNode.textContent).toContain('cn-hangzhou · 1 台')
    expect(rootNode.textContent).toContain('地域暂时不可用')
    vi.mocked(invoke).mockClear()
    retrying = true
    await click('重试失败地域')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('list_workbench_instances', { profile: 'default', region: 'cn-shanghai' })
    expect(rootNode.textContent).toContain('cn-shanghai · 1 台')
    await click('一键导入各地域')
    expect(JSON.parse(localStorage.getItem('serverdock.workbenchInstances')!)).toHaveLength(2)
  } finally {
    await act(async () => root.unmount())
    rootNode.remove()
    localStorage.clear()
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previous
  }
})
