# @flowscale/sdk — External App Guide

This guide covers building apps that run **outside** FlowScale using the HTTP transport. You can use any language or framework — Node.js scripts, Express servers, Next.js apps, Python backends calling a Node wrapper, anything that can make HTTP requests.

> **Prerequisite:** A running FlowScale AIOS instance. Default local address: `http://localhost:14173`.

---

## Installation

```bash
npm install @flowscale/sdk
# or
pnpm add @flowscale/sdk
```

Requires Node.js 18+ (uses the native `fetch` API).

---

## Authentication

Every request requires a session. Call `login()` once to get a token, then pass it to `createClient()`. Tokens are valid for **7 days**.

```ts
import { login, createClient } from '@flowscale/sdk'

const token = await login({
  baseUrl: 'http://localhost:14173',
  username: 'admin',
  password: 'your-password',
})

const client = createClient({
  baseUrl: 'http://localhost:14173',
  sessionToken: token,
})
```

> `login()` reads the session token from the `Set-Cookie` response header. This works in **Node.js** (`fetch` exposes `Set-Cookie`). In a browser context, the browser handles the cookie automatically and you do not need to call `login()` — just make requests with `credentials: 'include'` against `http://localhost:14173` directly.

### Persisting the token

```ts
import { writeFileSync, readFileSync, existsSync } from 'fs'

const TOKEN_FILE = '.flowscale-token'

async function getToken(): Promise<string> {
  if (existsSync(TOKEN_FILE)) {
    return readFileSync(TOKEN_FILE, 'utf-8').trim()
  }
  const token = await login({
    baseUrl: 'http://localhost:14173',
    username: 'admin',
    password: process.env.FS_PASSWORD!,
  })
  writeFileSync(TOKEN_FILE, token)
  return token
}
```

---

## Creating a client

```ts
const client = createClient({
  baseUrl: 'http://localhost:14173',  // required
  sessionToken: token,                 // required

  // Optional:
  timeout: 300_000,    // ms to wait for a tool to finish (default: 5 minutes)
  pollInterval: 2_000, // ms between status polls for API-engine tools (default: 2s)
})
```

---

## Listing tools

`client.tools.list()` returns all tools with `status = 'production'`. Each row is the raw DB record — the key field for running tools is `id`, and `schemaJson` (a JSON string) describes the inputs.

```ts
const tools = await client.tools.list()

for (const tool of tools) {
  console.log(tool.id, tool.name, tool.description)
}
```

---

## Inspecting a tool's inputs

The `schemaJson` field on each tool is a JSON string containing an array of `WorkflowIO` objects — one per configurable input or output node.

```ts
const tool = await client.tools.get('your-tool-id')

interface WorkflowIO {
  nodeId: string      // ComfyUI node ID, e.g. "6"
  nodeType: string    // e.g. "CLIPTextEncode"
  nodeTitle: string   // human label, e.g. "Positive Prompt"
  paramName: string   // e.g. "text"
  paramType: 'string' | 'number' | 'boolean' | 'image' | 'select'
  defaultValue?: unknown
  options?: string[]  // for paramType 'select'
  isInput: boolean    // false = output node
}

const schema: WorkflowIO[] = JSON.parse(tool.schemaJson)
const inputs = schema.filter(f => f.isInput)

for (const field of inputs) {
  console.log(`${field.nodeId}__${field.paramName}`, field.paramType, field.defaultValue)
}
```

---

## Running a tool

### Input key format

Input keys are always **`"${nodeId}__${paramName}"`** (double underscore). You can see the exact keys by inspecting `schemaJson` as shown above, or read them from the tool's form in the FlowScale UI.

```ts
const result = await client.tools.run('your-tool-id', {
  '6__text': 'a photorealistic cat on the moon, cinematic lighting',
  '7__text': 'blurry, low quality, watermark',
  '5__width': 1024,
  '5__height': 1024,
  '3__steps': 20,
  '3__cfg': 7,
})
```

`tools.run()` blocks until the tool finishes and returns a `ToolRunResult`:

```ts
interface ToolRunResult {
  executionId: string
  toolId: string
  status: 'completed'
  outputs: ToolOutputItem[]
}

interface ToolOutputItem {
  kind: 'image' | 'video' | 'audio' | 'file'
  filename: string
  subfolder: string
  path: string  // relative URL, e.g. /api/outputs/tool-id/abc12345_output.png
}
```

### Accessing outputs

Output `path` values are **relative URLs**. Use `client.resolveUrl()` to get the full URL for downloading or displaying:

```ts
for (const output of result.outputs) {
  const url = client.resolveUrl(output.path)
  console.log(output.kind, url)
  // e.g. image http://localhost:14173/api/outputs/tool-id/abc12345_output.png
}
```

### Downloading an output to disk

```ts
import { writeFileSync } from 'fs'
import path from 'path'

for (const output of result.outputs) {
  const url = client.resolveUrl(output.path)
  const res = await fetch(url, {
    headers: { Cookie: `fs_session=${token}` },
  })
  const buffer = Buffer.from(await res.arrayBuffer())
  writeFileSync(path.basename(output.filename), buffer)
  console.log('Saved', output.filename)
}
```

### Progress callback

```ts
const result = await client.tools.run('your-tool-id', inputs, {
  onProgress: (status) => console.log('[progress]', status),
  timeout: 120_000, // override the client default for this call
})
```

`onProgress` is called with `'running'` when the job starts and `'completed'` when it finishes. For API-engine tools it is also called on each poll cycle.

---

## Error handling

`tools.run()` throws a plain `Error` on failure. The message is either the error from FlowScale or a timeout message.

```ts
try {
  const result = await client.tools.run('your-tool-id', inputs)
  console.log('outputs:', result.outputs)
} catch (err) {
  if (err instanceof Error) {
    console.error('Tool failed:', err.message)
    // Possible messages:
    // - 'Tool not found'
    // - 'No ComfyUI port configured for this tool'
    // - 'ComfyUI reported an error'
    // - 'Execution timed out after 300s'
    // - Node-level error details from ComfyUI
  }
}
```

`login()` throws with the server's error message on bad credentials, disabled account, or network failure.

---

## Image inputs

For tools with `paramType: 'image'` inputs, you need to upload the image to the ComfyUI instance first, then pass the returned filename as the input value.

First discover which ComfyUI port the tool uses:

```ts
const tool = await client.tools.get('your-tool-id')
const comfyPort = tool.comfyPort  // e.g. 8188
```

Then upload the image via the ComfyUI proxy:

```ts
import { readFileSync } from 'fs'

async function uploadImage(
  baseUrl: string,
  token: string,
  comfyPort: number,
  filePath: string,
): Promise<string> {
  const fileBuffer = readFileSync(filePath)
  const filename = path.basename(filePath)

  const form = new FormData()
  form.append('image', new Blob([fileBuffer]), filename)
  form.append('overwrite', 'true')

  const res = await fetch(`${baseUrl}/api/comfy/${comfyPort}/upload/image`, {
    method: 'POST',
    headers: { Cookie: `fs_session=${token}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
  const data = await res.json() as { name: string }
  return data.name  // filename to pass as input
}

// Then run the tool:
const uploadedFilename = await uploadImage(
  'http://localhost:14173',
  token,
  tool.comfyPort,
  './photo.jpg',
)

const result = await client.tools.run('your-tool-id', {
  '10__image': uploadedFilename,
})
```

---

## Full example — text-to-image script

```ts
import { login, createClient } from '@flowscale/sdk'
import { writeFileSync } from 'fs'
import path from 'path'

const BASE = 'http://localhost:14173'

async function main() {
  // 1. Authenticate
  const token = await login({ baseUrl: BASE, username: 'admin', password: 'your-password' })
  const client = createClient({ baseUrl: BASE, sessionToken: token })

  // 2. List available tools
  const tools = await client.tools.list()
  console.log('Available tools:', tools.map(t => `${t.name} (${t.id})`))

  // 3. Inspect a tool's inputs
  const tool = tools[0]
  const schema = JSON.parse(tool.schemaJson)
  console.log('Inputs:')
  for (const field of schema.filter((f: { isInput: boolean }) => f.isInput)) {
    console.log(` ${field.nodeId}__${field.paramName} (${field.paramType})`)
  }

  // 4. Run the tool
  const result = await client.tools.run(tool.id, {
    '6__text': 'a majestic mountain landscape at golden hour',
    '7__text': 'blurry, noise, watermark',
    '5__width': 1024,
    '5__height': 1024,
    '3__steps': 20,
  }, {
    onProgress: (s) => process.stdout.write(`\r${s}...`),
  })

  console.log('\nDone. Outputs:')

  // 5. Download outputs
  for (const output of result.outputs) {
    const url = client.resolveUrl(output.path)
    const res = await fetch(url, { headers: { Cookie: `fs_session=${token}` } })
    const buffer = Buffer.from(await res.arrayBuffer())
    const outFile = `output_${output.filename}`
    writeFileSync(outFile, buffer)
    console.log(` Saved ${outFile} (${output.kind})`)
  }
}

main().catch(console.error)
```

---

## Full example — Express server wrapping a tool

```ts
import express from 'express'
import { login, createClient } from '@flowscale/sdk'

const app = express()
app.use(express.json())

const BASE = 'http://localhost:14173'
let client: Awaited<ReturnType<typeof createClient>> | null = null

async function getClient() {
  if (!client) {
    const token = await login({ baseUrl: BASE, username: 'admin', password: process.env.FS_PASSWORD! })
    client = createClient({ baseUrl: BASE, sessionToken: token })
  }
  return client
}

app.post('/generate', async (req, res) => {
  try {
    const { prompt, negativePrompt = '' } = req.body as { prompt: string; negativePrompt?: string }
    const c = await getClient()

    const result = await c.tools.run('your-tool-id', {
      '6__text': prompt,
      '7__text': negativePrompt,
    })

    const urls = result.outputs.map(o => ({
      kind: o.kind,
      url: c.resolveUrl(o.path),
    }))

    res.json({ executionId: result.executionId, outputs: urls })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.listen(3000, () => console.log('Server running on http://localhost:3000'))
```

---

## API reference

### `login(opts)`

```ts
login({
  baseUrl: string,
  username: string,
  password: string,
}): Promise<string>  // returns session token
```

Throws if credentials are invalid, the account is pending/disabled, or the server is unreachable.

### `createClient(opts)`

```ts
createClient({
  baseUrl: string,
  sessionToken: string,
  timeout?: number,      // default 300_000 ms
  pollInterval?: number, // default 2_000 ms
}): HttpClient
```

### `client.resolveUrl(path)`

Prepends `baseUrl` to a relative path. Returns the path unchanged if it is already an absolute URL.

### `client.tools.list()`

Returns all tools with `status = 'production'`. Each item includes the raw DB row with `id`, `name`, `description`, `schemaJson`, `comfyPort`, `engine`, etc.

### `client.tools.get(id)`

Returns a single tool by ID. Throws `'Tool not found'` (HTTP 404) if it does not exist.

### `client.tools.run(id, inputs, options?)`

```ts
client.tools.run(
  id: string,
  inputs: Record<string, unknown>,
  options?: {
    timeout?: number,
    onProgress?: (status: string) => void,
  }
): Promise<ToolRunResult>
```

Blocks until the tool completes. Input keys are `"${nodeId}__${paramName}"`. Throws on error or timeout.
