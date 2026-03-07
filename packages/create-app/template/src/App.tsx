import { useState } from 'react'
import FlowScale from '@flowscale/sdk'

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    setImageUrl(null)

    try {
      const result = await FlowScale.tools.run('sdxl-txt2img', {
        '6.text': prompt,
      })
      const first = result.outputs?.['9']
      if (first && typeof first === 'object' && 'url' in first) {
        setImageUrl((first as { url: string }).url)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
        __APP_NAME__
      </h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
          placeholder="Describe an image…"
          style={{
            flex: 1, padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
            border: '1px solid #3f3f46', background: '#18181b', color: '#e4e4e7',
            fontSize: '0.875rem', outline: 'none',
          }}
        />
        <button
          onClick={generate}
          disabled={loading || !prompt.trim()}
          style={{
            padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
            background: loading ? '#4b5563' : '#10b981', color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.875rem',
          }}
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && <p style={{ color: '#f87171', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>}

      {imageUrl && (
        <img
          src={imageUrl}
          alt="Generated"
          style={{ width: '100%', borderRadius: '0.75rem', border: '1px solid #3f3f46' }}
        />
      )}
    </div>
  )
}
