import { invoke } from '@tauri-apps/api/core'
import { api } from './api'
import type { Project, Server, Snapshot } from '../types/models'

export type TransferMode = 'direct' | 'relay'
export const serverdock = {
  async projects(): Promise<Project[]> { return api.isDesktop ? api.listProjects() : [] },
  async servers(): Promise<Server[]> {
    const servers = await api.listServers()
    return api.isDesktop ? servers : servers.map((server, i) => ({ ...server, name: ['compute-01', 'storage-01', 'worker-02', 'worker-03', 'archive-01', 'build-01'][i] ?? server.name, tags: ['Linux'] }))
  },
  async collect(id: string, disks: boolean): Promise<Snapshot> {
    const snapshot = await api.collectServer(id, true, disks, true, true)
    return { ...snapshot, gpus: [], processes: [], ...(!api.isDesktop ? {
      userResourcesSampled: true,
      userResources: [
        { uid: 1000, username: snapshot.username, processCount: 38, cpuUtilization: 8.4, cpuSampledProcessCount: 36, memoryUsedBytes: 12 * 1024 ** 3, isSystem: false },
        { uid: 1001, username: 'researcher', processCount: 21, cpuUtilization: 4.2, cpuSampledProcessCount: 21, memoryUsedBytes: 8 * 1024 ** 3, isSystem: false },
        { uid: 0, username: 'root', processCount: 84, cpuUtilization: 1.2, cpuSampledProcessCount: 80, memoryUsedBytes: 2 * 1024 ** 3, isSystem: true },
      ],
    } : {}) }
  },
  async transfer(projectId: string, targetServerId: string, mode: TransferMode) {
    if (!api.isDesktop) throw new Error('网页为演示模式，真实文件传输请使用 ServerDock 桌面应用。')
    return mode === 'relay' ? api.syncProject(projectId, targetServerId) : invoke('sync_project_direct', { projectId, targetServerId })
  },
}
