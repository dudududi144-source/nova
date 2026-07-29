'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Send, Loader2, MessageSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface ChatMsg { role: 'user' | 'assistant'; content: string; files?: any[]; ts: number }

export default function ChatPanel({
  chatHistory, chatInput, chatLoading, setChatInput, sendChat, setChatHistory,
}: {
  chatHistory: ChatMsg[]
  chatInput: string
  chatLoading: boolean
  setChatInput: (v: string) => void
  sendChat: () => void
  setChatHistory: (v: ChatMsg[]) => void
}) {
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [chatHistory, chatLoading])

  return (
    <>
      {/* Toggle button — floating bottom-left */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-4 left-4 z-[65] flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:scale-105"
        title="Chat with NOVA"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
        {chatHistory.length > 0 && !open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white">
            {chatHistory.length}
          </span>
        )}
      </button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-18 left-4 z-[65] flex h-[60vh] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15">
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Chat with NOVA</p>
                <p className="text-[10px] text-muted-foreground">Converse about this build · changes apply live</p>
              </div>
              {chatHistory.length > 0 && (
                <button onClick={() => setChatHistory([])} className="ml-auto text-[10px] text-muted-foreground hover:text-destructive">Clear</button>
              )}
            </div>
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
              {chatHistory.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                  <Brain className="mb-3 h-12 w-12 text-muted-foreground/20" />
                  <p className="text-sm font-medium">Ask NOVA anything</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground/60">"make it blue", "explain index.html", "add dark mode"</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {['Explain the project', 'Add dark mode', 'Make it responsive'].map(s => (
                      <button key={s} onClick={() => setChatInput(s)} className="rounded-full border border-border/40 bg-card/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {chatHistory.map((m, i) => (
                    <div key={i} className={cn('flex gap-2.5', m.role === 'user' ? 'flex-row-reverse' : '')}>
                      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground')}>
                        {m.role === 'user' ? 'You' : 'N'}
                      </div>
                      <div className={cn('min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed', m.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-muted/40 text-foreground/90')}>
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>
                        {m.files?.length > 0 && <p className="mt-1.5 text-[10px] text-emerald-500">✓ Applied to {m.files.length} file(s)</p>}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/50 text-[10px] font-bold text-muted-foreground">N</div>
                      <div className="rounded-lg bg-muted/40 px-3 py-2"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Input */}
            <div className="shrink-0 border-t border-border/40 p-3">
              <div className="flex items-end gap-2 rounded-xl border border-border/40 bg-card/50 p-2 focus-within:border-primary/50">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChat() } }}
                  placeholder="Message NOVA… (⌘+Enter)"
                  rows={1}
                  className="min-h-[36px] flex-1 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                />
                <Button size="sm" className="h-8 shrink-0 gap-1.5 px-3" onClick={sendChat} disabled={!chatInput.trim() || chatLoading}>
                  {chatLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
