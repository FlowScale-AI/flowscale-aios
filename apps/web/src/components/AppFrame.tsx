'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { AppManifest } from '@/lib/appManifest'
import type { JsonRpcRequest } from '@/lib/bridge/server'
import { BridgeServer } from '@/lib/bridge/server'

interface AppFrameProps {
  appId: string
  manifest: AppManifest
  userId: string | null
  className?: string
  bundlePath?: string
  source?: string
  installedAt?: number
}

export default function AppFrame({ appId, manifest, userId, className, bundlePath, source, installedAt }: AppFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<BridgeServer | null>(null)
  const [confirmState, setConfirmState] = useState<{
    title: string
    description?: string
    resolve: (v: boolean) => void
  } | null>(null)

  const sendToFrame = useCallback((msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  useEffect(() => {
    bridgeRef.current = new BridgeServer({
      appId,
      manifest,
      userId,
      send: sendToFrame,
      onToast: (_type, _message) => {
        // TODO: hook into global notification store once available
      },
      onConfirm: (title, description) =>
        new Promise<boolean>((resolve) => {
          setConfirmState({ title, description, resolve })
        }),
    })

    function handleMessage(event: MessageEvent) {
      if (!iframeRef.current) return
      // Only process messages from our iframe
      if (event.source !== iframeRef.current.contentWindow) return

      const msg = event.data as JsonRpcRequest
      if (!msg || msg.jsonrpc !== '2.0') return

      bridgeRef.current?.dispatch(msg)
    }

    window.addEventListener('message', handleMessage)

    // Hot reload for sideloaded apps (desktop only)
    if (source === 'sideloaded' && bundlePath && window.desktop?.watch) {
      window.desktop.watch.start(bundlePath, () => {
        iframeRef.current?.contentWindow?.location.reload()
      })
    }

    return () => {
      window.removeEventListener('message', handleMessage)
      if (source === 'sideloaded' && bundlePath && window.desktop?.watch) {
        window.desktop.watch.stop(bundlePath)
      }
      bridgeRef.current = null
    }
  }, [appId, manifest, userId, sendToFrame, source, bundlePath])

  const bundleSrc = `/api/apps/${appId}/bundle/${manifest.entry}${installedAt ? `?v=${installedAt}` : ''}`

  return (
    <>
      <iframe
        ref={iframeRef}
        src={bundleSrc}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className={className ?? 'w-full h-full border-0'}
        title={manifest.displayName}
      />

      {/* Host confirm dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 w-[360px] shadow-2xl">
            <h3 className="font-tech text-sm font-semibold text-zinc-100 mb-2">
              {confirmState.title}
            </h3>
            {confirmState.description && (
              <p className="text-sm text-zinc-400 mb-5">{confirmState.description}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  confirmState.resolve(false)
                  setConfirmState(null)
                }}
                className="px-4 py-2 text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmState.resolve(true)
                  setConfirmState(null)
                }}
                className="px-4 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
