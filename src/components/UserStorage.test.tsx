// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { UserStorage } from './UserStorage'
import { userStorage } from '../services/userStorage'
import type { UserResourceMetric } from '../types/models'

vi.mock('../services/userStorage', async importOriginal => {
  const original = await importOriginal<typeof import('../services/userStorage')>()
  return { ...original, userStorage: { discover: vi.fn(), get: vi.fn(), start: vi.fn(), cancel: vi.fn() } }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let element: HTMLDivElement
let root: ReturnType<typeof createRoot>
const users = [{ uid: 1000, username: 'alice' }] as UserResourceMetric[]
const paths = [{ uid: 1000, username: 'alice', path: '/mnt/data/alice' }, { uid: 1000, username: 'alice', path: '/mnt/data1/alice' }]
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element)
  vi.mocked(userStorage.get).mockResolvedValue(null)
  vi.mocked(userStorage.discover).mockResolvedValue(paths)
  vi.mocked(userStorage.start).mockImplementation(async (_, targets) => ({ running: false, queued: false, startedAt: Math.floor(Date.now() / 1000), finishedAt: Math.floor(Date.now() / 1000), entries: targets.map(target => ({ ...target, canonicalPath: target.path, bytes: 1024 ** 3, status: 'success', checkedAt: 100, error: null })) }))
})
afterEach(() => { act(() => root.unmount()); element.remove() })
it('discovers per-machine data roots and aggregates separate user directories', async () => {
  await act(async () => root.render(<UserStorage serverId="a" users={users} disks={[{ mountPoint: '/mnt/data1', usedBytes: 1, totalBytes: 2, availableBytes: 1 }]} />)); await flush()
  expect(userStorage.discover).toHaveBeenCalledWith('a', [{ uid: 1000, username: 'alice' }], ['/mnt/data1'])
  expect(userStorage.start).toHaveBeenCalledWith('a', paths)
  expect(element.querySelector('.sd-storage-totals')?.textContent).toContain('2.00 GiB')
  expect(element.textContent).toContain('/mnt/data1/alice')
})
it('persists path selection only for its server and does not hide inactive owners', async () => {
  const saved = [{ uid: 1001, username: 'inactive-user', path: '/other/data/inactive-user', enabled: true }]
  localStorage.setItem('serverdock.userStoragePaths.a', JSON.stringify(saved))
  await act(async () => root.render(<UserStorage serverId="a" users={users} disks={[]} />)); await flush()
  expect(userStorage.discover).not.toHaveBeenCalled()
  expect(element.textContent).toContain('inactive-user')
  const checkbox = element.querySelector<HTMLInputElement>('tbody input')!
  act(() => checkbox.click()); await flush()
  expect(JSON.parse(localStorage.getItem('serverdock.userStoragePaths.a')!)[0].enabled).toBe(false)
  expect(localStorage.getItem('serverdock.userStoragePaths.b')).toBeNull()
})
