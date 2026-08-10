'use client'

// v29.82: Extracted from page.tsx for maintainability

import { Button } from '@/components/ui/button'
import { Download, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

interface BackupFile {
  name: string
  size: number
  sizeFormatted: string
  modified: string
  url: string
}

interface BackupsModalProps {
  onClose: () => void
  backupFiles: BackupFile[]
  loadingBackups: boolean
  onRefresh: (files: BackupFile[]) => void
}

export function BackupsModal({ onClose, backupFiles, loadingBackups, onRefresh }: BackupsModalProps) {
  const createBackup = async () => {
    try {
      toast.info('Creating backup...')
      const res = await fetch('/api/backup', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        toast.success(`Backup created: ${data.fileName}`)
        const listRes = await fetch('/api/backup')
        const listData = await listRes.json()
        onRefresh(listData.files || [])
      } else {
        toast.error(data.error || 'Backup failed')
      }
    } catch {
      toast.error('Network error')
    }
  }

  const deleteBackup = async (name: string) => {
    if (!confirm(`Delete ${name}?`)) return
    try {
      const res = await fetch(`/api/backup?file=${encodeURIComponent(name)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) {
        toast.success(`Deleted: ${name}`)
        onRefresh(backupFiles.filter(f => f.name !== name))
      }
    } catch {
      toast.error('Delete failed')
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Backup files"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border/40 bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">NOVA Backups</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={createBackup}>
              <Download className="h-3.5 w-3.5" /> Create Backup
            </Button>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {loadingBackups ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : backupFiles.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">No backup files found.</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {backupFiles.map((file) => (
              <div key={file.name} className="flex items-center gap-3 border-b border-border/20 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{file.name}</p>
                  <p className="text-[10px] text-muted-foreground">{file.sizeFormatted} · {new Date(file.modified).toLocaleString()}</p>
                </div>
                <a href={file.url} className="text-emerald-400 hover:text-emerald-300" aria-label={`Download ${file.name}`}>
                  <Download className="h-4 w-4" />
                </a>
                <button type="button" onClick={() => deleteBackup(file.name)} className="text-red-400 hover:text-red-300" aria-label={`Delete ${file.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
