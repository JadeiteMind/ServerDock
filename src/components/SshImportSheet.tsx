import { useMemo, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import type { Server, ServerDraft } from '../types/models'
import { duplicateImportIndexes } from '../utils/serverIdentity'

export function SshImportSheet({ drafts, servers, onClose, onImport }: { drafts: ServerDraft[]; servers: Server[]; onClose: () => void; onImport: (drafts: ServerDraft[]) => Promise<void> }) {
  const duplicates = useMemo(() => duplicateImportIndexes(drafts, servers), [drafts, servers])
  const availableCount = drafts.length - duplicates.size
  const [selected, setSelected] = useState(() => new Set(drafts.map((_, index) => index).filter((index) => !duplicates.has(index))))
  const selectedDrafts = drafts.filter((_, index) => selected.has(index) && !duplicates.has(index))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = (index: number) => { if (!duplicates.has(index)) setSelected((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next }) }
  return <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="sheet import-sheet" role="dialog" aria-modal="true" aria-labelledby="ssh-import-title"><header className="sheet__header"><div><p className="eyebrow">OpenSSH Config</p><h2 id="ssh-import-title">选择要监控的服务器</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header><div className="import-list">{duplicates.size > 0 && <p className="import-notice" role="status"><AlertCircle size={15} /><span>已识别并跳过 {duplicates.size} 台重复服务器；相同用户名、地址与端口只保留一条连接。</span></p>}{drafts.map((draft, index) => { const duplicate = duplicates.has(index); return <label className={`import-row ${duplicate ? 'import-row--duplicate' : ''}`} key={`${draft.sshAlias}-${draft.host}-${index}`}><input type="checkbox" checked={selected.has(index)} disabled={duplicate} onChange={() => toggle(index)} /><span><strong>{draft.sshAlias || draft.name}</strong><small>{draft.username}@{draft.host}:{draft.port}{draft.proxyJump ? ` · via ${draft.proxyJump}` : ''}</small></span>{duplicate && <em>已存在</em>}</label>})}{error && <p className="form-error" role="alert">{error}</p>}</div><footer className="sheet__footer"><span className="sheet__selection-count">已选 {selectedDrafts.length} / {availableCount} 台可导入</span><button className="button button--secondary" onClick={onClose}>取消</button><button className="button button--primary" disabled={saving || selectedDrafts.length === 0} onClick={async () => { setSaving(true); setError(null); try { await onImport(selectedDrafts) } catch (reason) { setError(String(reason)) } finally { setSaving(false) } }}>{saving ? '导入中…' : `导入 ${selectedDrafts.length} 台`}</button></footer></section></div>
}

