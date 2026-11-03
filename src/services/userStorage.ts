import { invoke } from '@tauri-apps/api/core'
import { api } from './api'

export interface StorageTarget { uid: number; username: string; path: string }
export interface StorageEntry extends StorageTarget { canonicalPath: string | null; status: string; bytes: number | null; checkedAt: number | null; error: string | null }
export interface StorageScan { running: boolean; queued: boolean; startedAt: number; finishedAt: number | null; entries: StorageEntry[] }
const demo = new Map<string, StorageScan>()
export const userStorage = {
  async discover(serverId: string, users: Array<{ uid: number; username: string }>, mounts: string[]): Promise<StorageTarget[]> {
    if (api.isDesktop) return invoke('discover_user_storage', { serverId, users, mounts })
    return users.flatMap(user => ['/mnt/data', '/mnt/data1'].map(root => ({ ...user, path: `${root}/${user.username}` })))
  },
  async get(serverId: string): Promise<StorageScan | null> { return api.isDesktop ? invoke('get_user_storage', { serverId }) : demo.get(serverId) ?? null },
  async start(serverId: string, targets: StorageTarget[]): Promise<StorageScan> {
    if (api.isDesktop) return invoke('start_user_storage', { serverId, targets })
    const now = Math.floor(Date.now() / 1000)
    const scan = { running: false, queued: false, startedAt: now, finishedAt: now, entries: targets.map((target, index) => ({ ...target, canonicalPath: target.path, status: 'success', bytes: (index + 1) * 48 * 1024 ** 3, checkedAt: now, error: null })) }
    demo.set(serverId, scan); return scan
  },
  async cancel(serverId: string): Promise<void> { if (api.isDesktop) await invoke('cancel_user_storage', { serverId }) },
}

/** Deduplicate canonical aliases and nested paths within one user's subtotal. */
export function uniqueStorageEntries(entries: StorageEntry[], uid: number) {
  const known = entries.filter(entry => entry.uid === uid && entry.bytes !== null && entry.checkedAt !== null && entry.status !== 'overlap').sort((a, b) => (a.canonicalPath ?? a.path).length - (b.canonicalPath ?? b.path).length)
  const selected: StorageEntry[] = []
  for (const entry of known) {
    const path = (entry.canonicalPath ?? entry.path).replace(/\/+$/, '')
    if (!selected.some(parent => { const root = (parent.canonicalPath ?? parent.path).replace(/\/+$/, ''); return path === root || path.startsWith(`${root}/`) })) selected.push(entry)
  }
  return selected
}
