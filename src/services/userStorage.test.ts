import { expect, it } from 'vitest'
import { uniqueStorageEntries, type StorageEntry } from './userStorage'

it('does not double-count aliases, nested directories or another user', () => {
  const entry = (path: string, canonicalPath: string, bytes: number, uid = 1000): StorageEntry => ({ uid, username: 'alice', path, canonicalPath, bytes, checkedAt: 100, status: 'success', error: null })
  const entries = [entry('/mnt/data/alice/models', '/disk/alice/models', 50), entry('/mnt/data/alice', '/disk/alice', 100), entry('/link/alice', '/disk/alice', 100), entry('/mnt/data1/alice', '/disk1/alice', 200), entry('/disk/bob', '/disk/bob', 900, 1001)]
  expect(uniqueStorageEntries(entries, 1000).reduce((sum, entry) => sum + entry.bytes!, 0)).toBe(300)
  expect(uniqueStorageEntries(entries, 1001)).toHaveLength(1)
  expect(uniqueStorageEntries([{ ...entries[0], status: 'overlap' }, { ...entries[1], bytes: null }], 1000)).toEqual([])
})
