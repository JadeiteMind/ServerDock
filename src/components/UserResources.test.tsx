// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { UserResources } from './UserResources'
import type { Snapshot } from '../types/models'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let element: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined
afterEach(() => { if (root) act(() => root!.unmount()); element?.remove() })
it('counts full user samples, filters system accounts and preserves unknown CPU', () => {
  const snapshot = { timestamp: 100, username: 'alice', system: { memoryTotalBytes: 16 * 1024 ** 3 }, cpuProcesses: [], userResourcesSampled: true, userResources: [
    { uid: 1000, username: 'alice', processCount: 150, cpuUtilization: 25, cpuSampledProcessCount: 140, memoryUsedBytes: 2 * 1024 ** 3, isSystem: false },
    { uid: 1001, username: 'bob', processCount: 2, cpuUtilization: null, cpuSampledProcessCount: 0, memoryUsedBytes: 1024 ** 3, isSystem: false },
    { uid: 0, username: 'root', processCount: 50, cpuUtilization: 5, cpuSampledProcessCount: 50, memoryUsedBytes: 1024 ** 3, isSystem: true },
  ] } as unknown as Snapshot
  element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element)
  act(() => root!.render(<UserResources snapshot={snapshot} />))
  expect(element.querySelectorAll('tbody tr')).toHaveLength(2)
  expect(element.textContent).toContain('152')
  expect(element.textContent).toContain('25.0%')
  expect(element.querySelectorAll('tbody tr')[1].textContent).toContain('—')
  act(() => element!.querySelector<HTMLInputElement>('input')!.click())
  expect(element.querySelectorAll('tbody tr')).toHaveLength(3)
  expect(element.textContent).toContain('30.0%')
  act(() => root!.render(<UserResources snapshot={{ ...snapshot, userResourcesSampled: false }} />))
  expect(element.textContent).toContain('等待完整用户采样')
  expect(element.querySelector('table')).toBeNull()
})
