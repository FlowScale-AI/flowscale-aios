# ComfyUI Settings UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the ComfyUI settings tab into a guided blank-state onboarding wizard (3 setup paths) + a clean active dashboard (instance management, editable labels, add/delete instances, advanced config in a modal).

**Architecture:** Backend changes first (data model, new API routes), then a new `ComfyUITab.tsx` file extracted from the monolithic `settings/page.tsx`, then UI features built on top. A shared `instanceLabel.ts` helper drives consistent label display across settings and `ComputePicker`.

**Tech Stack:** Next.js 15 App Router, React (hooks only, no new libraries), TanStack Query, TypeScript strict, Tailwind, Phosphor icons, existing `<Modal>` component from `@flowscale/ui`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/web/src/lib/instanceLabel.ts` | `getInstanceDisplayLabel` pure helper |
| Create | `apps/web/src/lib/__tests__/instanceLabel.test.ts` | Unit tests for the helper |
| Modify | `apps/web/src/lib/providerSettings.ts` | Add `gpuName?`, `customLabel?` to `ComfyInstanceConfig` |
| Modify | `apps/web/src/app/api/comfy/instances/detect/route.ts` | Set `gpuName` on GPU instances |
| Modify | `apps/web/src/app/api/settings/comfy-instances/route.ts` | Accept `customLabel` updates |
| Create | `apps/web/src/app/api/comfy/instances/add/route.ts` | Add single GPU instance |
| Create | `apps/web/src/app/api/comfy/instances/[id]/route.ts` | Delete instance |
| Create | `apps/web/src/app/(main)/settings/ComfyUITab.tsx` | All ComfyUI tab components |
| Modify | `apps/web/src/app/(main)/settings/page.tsx` | Remove ComfyUITab block, import new file |
| Modify | `apps/web/src/components/ComputePicker.tsx` | Use `getInstanceDisplayLabel` |

---

## Task 1: `instanceLabel.ts` helper

**Files:**
- Create: `apps/web/src/lib/instanceLabel.ts`
- Create: `apps/web/src/lib/__tests__/instanceLabel.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/lib/__tests__/instanceLabel.test.ts
import { describe, it, expect } from 'vitest'
import { getInstanceDisplayLabel } from '../instanceLabel'

describe('getInstanceDisplayLabel', () => {
  it('returns customLabel when set', () => {
    expect(getInstanceDisplayLabel({ customLabel: 'Image Gen', gpuName: 'RTX 4090', port: 41188 }))
      .toBe('Image Gen')
  })

  it('returns gpuName :port when no customLabel', () => {
    expect(getInstanceDisplayLabel({ gpuName: 'RTX 4090', port: 41188 }))
      .toBe('RTX 4090 :41188')
  })

  it('returns CPU :port when neither customLabel nor gpuName', () => {
    expect(getInstanceDisplayLabel({ port: 41189 }))
      .toBe('CPU :41189')
  })

  it('treats empty string customLabel as unset', () => {
    expect(getInstanceDisplayLabel({ customLabel: '', gpuName: 'RTX 4090', port: 41188 }))
      .toBe('RTX 4090 :41188')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm exec vitest run src/lib/__tests__/instanceLabel.test.ts
```

Expected: FAIL — `Cannot find module '../instanceLabel'`

- [ ] **Step 3: Implement the helper**

```typescript
// apps/web/src/lib/instanceLabel.ts

export interface InstanceLabelInfo {
  customLabel?: string
  gpuName?: string
  port: number
}

export function getInstanceDisplayLabel(inst: InstanceLabelInfo): string {
  if (inst.customLabel) return inst.customLabel
  if (inst.gpuName) return `${inst.gpuName} :${inst.port}`
  return `CPU :${inst.port}`
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && pnpm exec vitest run src/lib/__tests__/instanceLabel.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/instanceLabel.ts apps/web/src/lib/__tests__/instanceLabel.test.ts
git commit -m "feat: add getInstanceDisplayLabel helper"
```

---

## Task 2: Extend `ComfyInstanceConfig` with `gpuName` and `customLabel`

**Files:**
- Modify: `apps/web/src/lib/providerSettings.ts`
- Modify: `apps/web/src/lib/__tests__/providerSettings.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the existing `describe('ComfyInstanceConfig.launchScriptId', ...)` block in `apps/web/src/lib/__tests__/providerSettings.test.ts`:

```typescript
describe('ComfyInstanceConfig.gpuName and customLabel', () => {
  it('persists and retrieves gpuName', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0 — RTX 4090', gpuName: 'RTX 4090' },
    ])
    expect(getComfyInstances()[0].gpuName).toBe('RTX 4090')
  })

  it('persists and retrieves customLabel', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0 — RTX 4090', customLabel: 'Image Gen' },
    ])
    expect(getComfyInstances()[0].customLabel).toBe('Image Gen')
  })

  it('allows gpuName and customLabel to be absent', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0 — RTX 4090' },
    ])
    const inst = getComfyInstances()[0]
    expect(inst.gpuName).toBeUndefined()
    expect(inst.customLabel).toBeUndefined()
  })

  it('clears customLabel when set to empty string and re-read', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0', customLabel: '' },
    ])
    // empty string should survive the round-trip (filtering is at display layer)
    expect(getComfyInstances()[0].customLabel).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && pnpm exec vitest run src/lib/__tests__/providerSettings.test.ts
```

Expected: FAIL — gpuName and customLabel come back undefined even when set (validation filter strips unknown fields)

- [ ] **Step 3: Update `ComfyInstanceConfig` and validation filter**

In `apps/web/src/lib/providerSettings.ts`, update the interface and the validation filter:

```typescript
export interface ComfyInstanceConfig {
  /** Stable identifier, e.g. 'gpu-0', 'cpu' */
  id: string
  /** Port this instance listens on */
  port: number
  /** Device specifier: 'cuda:0', 'rocm:1', 'cpu' */
  device: string
  /** Human-readable label, e.g. 'GPU 0 — RTX 4090' — kept for backwards compat */
  label: string
  /** GPU model name only, e.g. 'RTX 4090' — absent for CPU instances */
  gpuName?: string
  /** User-editable display name — takes priority over fallback when non-empty */
  customLabel?: string
  /** References CustomScript.id; absent = AIOS managed launch */
  launchScriptId?: string
}
```

Update the validation filter in `getComfyInstances()` — change the filter lambda to:

```typescript
const validated = arr.filter(
  (i): i is ComfyInstanceConfig =>
    typeof i === 'object' && i !== null &&
    typeof i.id === 'string' &&
    typeof i.port === 'number' && Number.isInteger(i.port) && i.port >= 1024 && i.port <= 65535 &&
    typeof i.device === 'string' &&
    typeof i.label === 'string' &&
    (typeof i.launchScriptId === 'undefined' || typeof i.launchScriptId === 'string') &&
    (typeof i.gpuName === 'undefined' || typeof i.gpuName === 'string') &&
    (typeof i.customLabel === 'undefined' || typeof i.customLabel === 'string'),
)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm exec vitest run src/lib/__tests__/providerSettings.test.ts
```

Expected: PASS (all tests including new ones)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/providerSettings.ts apps/web/src/lib/__tests__/providerSettings.test.ts
git commit -m "feat: add gpuName and customLabel fields to ComfyInstanceConfig"
```

---

## Task 3: Populate `gpuName` in detect route

**Files:**
- Modify: `apps/web/src/app/api/comfy/instances/detect/route.ts`

- [ ] **Step 1: Add `gpuName` to each GPU instance in the detect POST handler**

In `apps/web/src/app/api/comfy/instances/detect/route.ts`, update the GPU instance creation inside the `for` loop. Replace:

```typescript
instances.push({
  id,
  port: basePort + i,
  device: `${devicePrefix}:${gpu.index}`,
  label: `GPU ${gpu.index} — ${gpu.name}`,
  ...(prior?.launchScriptId ? { launchScriptId: prior.launchScriptId } : {}),
})
```

With:

```typescript
instances.push({
  id,
  port: basePort + i,
  device: `${devicePrefix}:${gpu.index}`,
  label: `GPU ${gpu.index} — ${gpu.name}`,
  gpuName: gpu.name,
  ...(prior?.launchScriptId ? { launchScriptId: prior.launchScriptId } : {}),
  ...(prior?.customLabel ? { customLabel: prior.customLabel } : {}),
})
```

Note: `gpuName` is not preserved from `prior` intentionally — it always reflects the current detected GPU name. `customLabel` IS preserved so re-detecting doesn't erase the user's label.

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit 2>&1 | grep "instances/detect"
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/comfy/instances/detect/route.ts
git commit -m "feat: populate gpuName on GPU instances during detect"
```

---

## Task 4: Accept `customLabel` in the comfy-instances settings route

**Files:**
- Modify: `apps/web/src/app/api/settings/comfy-instances/route.ts`

- [ ] **Step 1: Update the merge logic to handle `customLabel`**

In `apps/web/src/app/api/settings/comfy-instances/route.ts`, update the `updates` type and the merge loop.

Replace:

```typescript
const updates = body.instances as Array<{ id: string; launchScriptId?: string | null }>
```

With:

```typescript
const updates = body.instances as Array<{ id: string; launchScriptId?: string | null; customLabel?: string | null }>
```

Inside the `for (const inst of existing)` loop, after the `launchScriptId` block, add:

```typescript
// customLabel
if (update.customLabel === null || update.customLabel === '') {
  delete next.customLabel
} else if (typeof update.customLabel === 'string') {
  next.customLabel = update.customLabel
}
```

The full updated loop body:

```typescript
for (const inst of existing) {
  const update = updates.find((u) => u.id === inst.id)
  if (!update) { merged.push(inst); continue }
  const next = { ...inst }

  // launchScriptId
  if (update.launchScriptId === null || update.launchScriptId === '') {
    delete next.launchScriptId
  } else if (typeof update.launchScriptId === 'string') {
    if (!scripts.some((s) => s.id === update.launchScriptId)) {
      return NextResponse.json(
        { error: `Custom script '${update.launchScriptId}' not found in registry` },
        { status: 400 },
      )
    }
    next.launchScriptId = update.launchScriptId
  }

  // customLabel
  if (update.customLabel === null || update.customLabel === '') {
    delete next.customLabel
  } else if (typeof update.customLabel === 'string') {
    next.customLabel = update.customLabel
  }

  merged.push(next)
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit 2>&1 | grep "comfy-instances"
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/settings/comfy-instances/route.ts
git commit -m "feat: accept customLabel updates in comfy-instances settings route"
```

---

## Task 5: `POST /api/comfy/instances/add` route

**Files:**
- Create: `apps/web/src/app/api/comfy/instances/add/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// apps/web/src/app/api/comfy/instances/add/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { detectGpus } from '@/lib/gpu-detect'
import { getComfyInstances, setComfyInstances, type ComfyInstanceConfig } from '@/lib/providerSettings'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { gpuIndex?: unknown } | null
  const gpuIndex = typeof body?.gpuIndex === 'number' ? body.gpuIndex : Number(body?.gpuIndex)
  if (!Number.isInteger(gpuIndex) || gpuIndex < 0) {
    return NextResponse.json({ error: 'gpuIndex (non-negative integer) required' }, { status: 400 })
  }

  const gpus = detectGpus()
  const gpu = gpus.find((g) => g.index === gpuIndex)
  if (!gpu) {
    return NextResponse.json({ error: `No GPU found at index ${gpuIndex}` }, { status: 404 })
  }

  const existing = getComfyInstances()
  const instanceId = `gpu-${gpu.index}`

  if (existing.some((i) => i.id === instanceId)) {
    return NextResponse.json({ error: `Instance ${instanceId} already exists` }, { status: 409 })
  }

  const maxPort = existing.reduce((m, i) => Math.max(m, i.port), 41187)
  const newPort = maxPort + 1

  const devicePrefix = gpu.backend === 'rocm' ? 'rocm' : 'cuda'
  const newInstance: ComfyInstanceConfig = {
    id: instanceId,
    port: newPort,
    device: `${devicePrefix}:${gpu.index}`,
    label: `GPU ${gpu.index} — ${gpu.name}`,
    gpuName: gpu.name,
  }

  setComfyInstances([...existing, newInstance])

  return NextResponse.json({ instance: newInstance })
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit 2>&1 | grep "instances/add"
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/comfy/instances/add/route.ts
git commit -m "feat: add POST /api/comfy/instances/add endpoint"
```

---

## Task 6: `DELETE /api/comfy/instances/[id]` route

**Files:**
- Create: `apps/web/src/app/api/comfy/instances/[id]/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// apps/web/src/app/api/comfy/instances/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getComfyInstances, setComfyInstances } from '@/lib/providerSettings'
import { getInstanceStatus, stopInstance } from '@/lib/comfyui-manager'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = getComfyInstances()
  if (!existing.some((i) => i.id === id)) {
    return NextResponse.json({ error: `Instance '${id}' not found` }, { status: 404 })
  }

  // Stop the instance if it's still alive — stopInstance handles PID file cleanup
  const status = getInstanceStatus(id)
  if (status.alive) {
    stopInstance(id)
  }

  setComfyInstances(existing.filter((i) => i.id !== id))

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit 2>&1 | grep "instances/\[id\]"
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/comfy/instances/[id]/route.ts"
git commit -m "feat: add DELETE /api/comfy/instances/[id] endpoint"
```

---

## Task 7: Extract `ComfyUITab` to its own file

This is a pure move — no behavior changes yet. The goal is to get a clean `ComfyUITab.tsx` that passes typecheck before any UI modifications begin.

**Files:**
- Create: `apps/web/src/app/(main)/settings/ComfyUITab.tsx`
- Modify: `apps/web/src/app/(main)/settings/page.tsx`

- [ ] **Step 1: Create `ComfyUITab.tsx` with the moved code**

Create `apps/web/src/app/(main)/settings/ComfyUITab.tsx` with this exact content — copy lines 1346–2315 from `settings/page.tsx` and add the necessary imports at the top. Do NOT include `useCallback` or `FormEvent` — those are only used in `SettingsPageInner` in `page.tsx`, not in the ComfyUI tab components.

```typescript
"use client";

import {
  useState,
  useEffect,
} from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  Lightning,
  Play,
  Stop,
  ArrowCounterClockwise,
  CircleNotch,
  X,
  FolderOpen,
  Warning,
  FileText,
  ArrowRight,
  CheckCircle,
} from "phosphor-react";
import { Modal } from "@flowscale/ui";
import { useModalStatus } from "@/hooks/useModalStatus";
import { ModalComfySection } from "@/components/ModalComfySection";

// ─── Types (local copies — not exported from page.tsx) ────────────────────────

interface ComfyDeviceInfo {
  name: string;
  type: string;
  index: number;
}

interface ComfyManagedInstance {
  id: string;
  status: "running" | "starting" | "stopped";
  pid?: number;
  port: number;
  configuredPort?: number;
  device: string;
  label: string;
  gpuName?: string;
  customLabel?: string;
  launchScriptId?: string;
  devices?: ComfyDeviceInfo[];
}

interface ComfyManageResponse {
  instances: ComfyManagedInstance[];
  managedPath: string | null;
  installType: string | null;
  isSetup: boolean;
}

// ─── Then paste InstanceStatusBadge and ComfyUITab verbatim from page.tsx ───
```

After the imports and type declarations, paste the full `InstanceStatusBadge` function (lines 1348–1370) and the full `ComfyUITab` function (lines 1372–2315) from `settings/page.tsx` verbatim.

Add a named export at the bottom:
```typescript
export { ComfyUITab };
```

- [ ] **Step 2: Remove the moved code from `settings/page.tsx`**

In `apps/web/src/app/(main)/settings/page.tsx`:

1. Delete lines 1346–2315 (the entire `// ─── ComfyUI Tab ───` section through the closing `}` of `ComfyUITab`)
2. Add the import at the top of the file (with the other imports):
```typescript
import { ComfyUITab } from "./ComfyUITab";
```
3. The existing render `{tab === "comfyui" && <ComfyUITab showError={showError} />}` at line ~352 stays unchanged.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck 2>&1 | head -40
```

Expected: no errors related to ComfyUITab

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(main\)/settings/ComfyUITab.tsx apps/web/src/app/\(main\)/settings/page.tsx
git commit -m "refactor: extract ComfyUITab to own file"
```

---

## Task 8: Update `ComputePicker` to use `getInstanceDisplayLabel`

**Files:**
- Modify: `apps/web/src/components/ComputePicker.tsx`

- [ ] **Step 1: Add `gpuName` and `customLabel` to `ComputeInstance` interface and use the helper**

In `apps/web/src/components/ComputePicker.tsx`:

1. Add the import at the top:
```typescript
import { getInstanceDisplayLabel } from "@/lib/instanceLabel";
```

2. Update the `ComputeInstance` interface:
```typescript
interface ComputeInstance {
  id: string
  status: string
  port: number
  device: string
  label: string
  gpuName?: string
  customLabel?: string
}
```

3. Replace the `selectedLabel` computation:
```typescript
// Before:
const selectedLabel =
  selected === "modal"
    ? "Modal (Cloud)"
    : selected === "auto"
    ? "Auto"
    : instances.find((i) => String(i.port) === selected)?.label ?? "Select"

// After:
const selectedLabel = (() => {
  if (selected === "modal") return "Modal (Cloud)"
  if (selected === "auto") return "Auto"
  const inst = instances.find((i) => String(i.port) === selected)
  return inst ? getInstanceDisplayLabel(inst) : "Select"
})()
```

4. In the dropdown items list, find where instances are rendered (around line 215):
```typescript
// Before:
{gpu ? gpu.name : inst.label}

// After:
{getInstanceDisplayLabel(inst)}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck 2>&1 | grep -i "computepicker\|instancelabel"
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ComputePicker.tsx
git commit -m "feat: use getInstanceDisplayLabel in ComputePicker"
```

---

## Task 9: Dashboard — polling fix + editable labels + delete button

**Files:**
- Modify: `apps/web/src/app/(main)/settings/ComfyUITab.tsx`

### 9a: Fix polling to watch running instances

- [ ] **Step 1: Update the `refetchInterval` in the `comfy-manage` query**

In `ComfyUITab.tsx`, find the `comfy-manage` useQuery and update its `refetchInterval`:

```typescript
// Before:
refetchInterval: (q) => {
  const data = q.state.data;
  if (!data) return false;
  const anyStarting = data.instances?.some(
    (i: ComfyManagedInstance) => i.status === "starting",
  );
  return anyStarting ? 2000 : false;
},

// After:
refetchInterval: (q) => {
  const data = q.state.data;
  if (!data) return false;
  const anyActive = data.instances?.some(
    (i: ComfyManagedInstance) => i.status === "starting" || i.status === "running",
  );
  return anyActive ? 5000 : false;
},
```

### 9b: Add editable label per managed instance row

- [ ] **Step 2: Add label editing state to `ComfyUITab`**

Near the top of `ComfyUITab` function body, add:

```typescript
const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
const [labelInput, setLabelInput] = useState("");

const saveLabelMutation = useMutation({
  mutationFn: async ({ instanceId, customLabel }: { instanceId: string; customLabel: string }) => {
    const res = await fetch("/api/settings/comfy-instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instances: [{ id: instanceId, customLabel: customLabel || null }] }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || "Failed to save label");
    }
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["comfy-manage"] });
    setEditingLabelId(null);
  },
  onError: (err: Error) => { showError(err.message); },
});

const startEditLabel = (inst: ComfyManagedInstance) => {
  setEditingLabelId(inst.id);
  setLabelInput(inst.customLabel ?? "");
};

const commitLabel = (instanceId: string) => {
  saveLabelMutation.mutate({ instanceId, customLabel: labelInput });
};
```

- [ ] **Step 3: Import `getInstanceDisplayLabel` and `PencilSimple` in `ComfyUITab.tsx`**

Add to the imports at the top of `ComfyUITab.tsx`:

```typescript
import { getInstanceDisplayLabel } from "@/lib/instanceLabel";
```

Add `PencilSimple` and `Trash` to the Phosphor import line.

- [ ] **Step 4: Replace the label display in the instance row**

In the instance row JSX, find:

```tsx
<span className="text-xs font-medium text-zinc-300">
  {inst.label}
</span>
```

Replace with:

```tsx
{!inst.external && editingLabelId === inst.id ? (
  <input
    autoFocus
    value={labelInput}
    onChange={(e) => setLabelInput(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") commitLabel(inst.id);
      if (e.key === "Escape") setEditingLabelId(null);
    }}
    onBlur={() => commitLabel(inst.id)}
    className="text-xs font-medium bg-zinc-800 border border-emerald-500/50 rounded px-1.5 py-0.5 text-zinc-200 w-32 focus:outline-none"
    placeholder="Custom label"
  />
) : (
  <span className="text-xs font-medium text-zinc-300">
    {inst.external ? inst.label : getInstanceDisplayLabel(inst)}
  </span>
)}
{!inst.external && editingLabelId !== inst.id && (
  <button
    onClick={() => startEditLabel(inst)}
    className="p-0.5 text-zinc-700 hover:text-zinc-400 transition-colors"
    title="Edit label"
  >
    <PencilSimple size={11} />
  </button>
)}
```

### 9c: Add delete button per managed instance row

- [ ] **Step 5: Add delete mutation**

In `ComfyUITab` function body, add:

```typescript
const deleteInstanceMutation = useMutation({
  mutationFn: async (instanceId: string) => {
    const res = await fetch(`/api/comfy/instances/${encodeURIComponent(instanceId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || "Delete failed");
    }
  },
  onSuccess: () => {
    refetchManage();
    queryClient.invalidateQueries({ queryKey: ["comfy-instances"] });
  },
  onError: (err: Error) => { showError(err.message); },
});
```

- [ ] **Step 6: Add trash icon button to each managed instance row's action buttons**

In the action buttons group (`<div className="flex items-center gap-1.5">`), add at the end of the managed-instance buttons (after the log button and before the external stop button):

```tsx
{!inst.external && (
  <button
    onClick={() => deleteInstanceMutation.mutate(inst.id)}
    disabled={
      deleteInstanceMutation.isPending ||
      inst.status === "running" ||
      inst.status === "starting"
    }
    className="p-1 text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    title={
      inst.status === "running" || inst.status === "starting"
        ? "Stop the instance before deleting"
        : `Delete ${inst.label}`
    }
  >
    <Trash size={12} />
  </button>
)}
```

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck 2>&1 | grep "ComfyUITab"
```

Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/\(main\)/settings/ComfyUITab.tsx
git commit -m "feat: polling fix, editable instance labels, delete instance button"
```

---

## Task 10: "Add Instance" button + dropdown

**Files:**
- Modify: `apps/web/src/app/(main)/settings/ComfyUITab.tsx`

- [ ] **Step 1: Add GPU data query and add-instance mutation**

In `ComfyUITab` function body, add:

```typescript
const [showAddDropdown, setShowAddDropdown] = useState(false);

const { data: gpuData } = useQuery<{ gpus: Array<{ index: number; name: string; vramMB: number; backend: string }>; cpu: unknown }>({
  queryKey: ["gpu-detect"],
  queryFn: async () => {
    const res = await fetch("/api/gpu");
    if (!res.ok) return { gpus: [] };
    return res.json();
  },
  staleTime: 60_000,
});

const addInstanceMutation = useMutation({
  mutationFn: async (gpuIndex: number) => {
    const res = await fetch("/api/comfy/instances/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gpuIndex }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || "Failed to add instance");
    }
    return res.json();
  },
  onSuccess: () => {
    setShowAddDropdown(false);
    refetchManage();
    queryClient.invalidateQueries({ queryKey: ["comfy-instances"] });
  },
  onError: (err: Error) => { showError(err.message); },
});
```

- [ ] **Step 2: Compute unassigned GPUs**

In `ComfyUITab` function body (after `managedInstances` is defined):

```typescript
const assignedGpuIndices = new Set(
  managedInstances
    .map((i) => {
      const m = i.id.match(/^gpu-(\d+)$/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter((n): n is number => n !== null),
);
const unassignedGpus = (gpuData?.gpus ?? []).filter(
  (g) => !assignedGpuIndices.has(g.index),
);
const allGpusAssigned = (gpuData?.gpus ?? []).length > 0 && unassignedGpus.length === 0;
```

- [ ] **Step 3: Add "Add Instance" button and dropdown to the instance card header**

Import `Plus` from phosphor-react. In the card header row (where the bulk Start All / Stop All buttons are), add after those buttons and before the "View details" link:

```tsx
{comfyManage?.isSetup && (gpuData?.gpus ?? []).length > 0 && (
  <div className="relative">
    <button
      onClick={() => setShowAddDropdown((v) => !v)}
      disabled={allGpusAssigned || addInstanceMutation.isPending}
      title={allGpusAssigned ? "All GPUs are in use" : "Add instance for another GPU"}
      className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 text-[11px] font-medium rounded-lg transition-colors border border-zinc-700"
    >
      <Plus size={10} weight="bold" />
      Add Instance
    </button>
    {showAddDropdown && unassignedGpus.length > 0 && (
      <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden min-w-[180px]">
        {unassignedGpus.map((gpu) => (
          <button
            key={gpu.index}
            onClick={() => addInstanceMutation.mutate(gpu.index)}
            disabled={addInstanceMutation.isPending}
            className="w-full text-left flex items-start gap-2 px-3 py-2.5 hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <Lightning size={13} className="text-zinc-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-medium text-zinc-200">{gpu.name}</div>
              <div className="text-[10px] text-zinc-500">
                {(gpu.vramMB / 1024).toFixed(0)} GB · GPU {gpu.index}
              </div>
            </div>
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

Close the dropdown on outside click using a `useEffect` (add this in the function body):

```typescript
const addDropdownRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (!showAddDropdown) return;
  const handler = (e: MouseEvent) => {
    if (addDropdownRef.current && !addDropdownRef.current.contains(e.target as Node)) {
      setShowAddDropdown(false);
    }
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, [showAddDropdown]);
```

Wrap the dropdown `<div className="relative">` with `ref={addDropdownRef}`.

Import `useRef` at the top of the file.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck 2>&1 | grep "ComfyUITab"
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(main\)/settings/ComfyUITab.tsx
git commit -m "feat: Add Instance button with GPU dropdown"
```

---

## Task 11: Configuration modal ("Edit Configuration")

**Files:**
- Modify: `apps/web/src/app/(main)/settings/ComfyUITab.tsx`

This task moves the Advanced paths `<details>` accordion content into a `<Modal>` triggered by an "Edit Configuration" button in the dashboard header. The save mutations and state variables already exist in the file — they just need to be reorganized.

- [ ] **Step 1: Add config modal open/close state**

In `ComfyUITab` function body:

```typescript
const [configModalOpen, setConfigModalOpen] = useState(false);
```

- [ ] **Step 2: Add "Edit Configuration" button to the dashboard header row**

In the card header row, before the bulk buttons, add:

```tsx
<button
  onClick={() => setConfigModalOpen(true)}
  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800 border border-transparent hover:border-zinc-700 rounded-lg transition-colors"
>
  <GearSix size={13} />
  Edit Configuration
</button>
```

- [ ] **Step 3: Replace the `<details>` accordion with a `<Modal>`**

Remove the entire `<details className="group border-t border-white/5 pt-4 mt-4">...</details>` block from the card JSX.

Add the following Modal after the card's closing `</div>` tag (alongside the existing spawn-log and external-stop modals):

```tsx
<Modal
  isOpen={configModalOpen}
  onClose={() => setConfigModalOpen(false)}
  title="ComfyUI Configuration"
  maxWidth="max-w-xl"
>
  <div className="space-y-6">
    {/* Installation path */}
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
        Installation path
      </label>
      {savedPath && (
        <p className="text-xs text-emerald-400 font-mono mb-2 flex items-center gap-1.5">
          <CheckCircle size={11} weight="fill" />
          {savedPath}
        </p>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder={savedPath ?? "/path/to/ComfyUI"}
            className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
        <button
          disabled={!pathInput.trim() || savePathMutation.isPending}
          onClick={() => savePathMutation.mutate(pathInput.trim())}
          className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pathSaved ? "Saved ✓" : "Save"}
        </button>
      </div>
      <p className="text-[11px] text-zinc-600 mt-1.5">
        Root directory of your ComfyUI install. Models will be downloaded into <span className="font-mono">models/</span> subdirectories.
      </p>
    </div>

    {/* Python executable */}
    <div className="border-t border-white/5 pt-4">
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
        Python executable <span className="text-zinc-600 font-normal">(optional)</span>
      </label>
      {savedPythonPath && (
        <p className="text-xs text-emerald-400 font-mono mb-2 flex items-center gap-1.5">
          <CheckCircle size={11} weight="fill" />
          {savedPythonPath}
        </p>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            type="text"
            value={pythonInput}
            onChange={(e) => setPythonInput(e.target.value)}
            placeholder={savedPythonPath ?? "e.g. /path/to/.venv/bin/python"}
            className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
        <button
          disabled={!pythonInput.trim() || savePythonPathMutation.isPending}
          onClick={() => savePythonPathMutation.mutate(pythonInput.trim())}
          className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pythonSaved ? "Saved ✓" : "Save"}
        </button>
        {savedPythonPath && (
          <button
            disabled={savePythonPathMutation.isPending}
            onClick={() => savePythonPathMutation.mutate("")}
            className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors disabled:opacity-40"
            title="Clear override"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-[11px] text-zinc-600 mt-1.5">
        Point to the <span className="font-mono">python</span> inside your venv when it lives outside the ComfyUI source tree. Leave blank to auto-detect.
      </p>
    </div>

    {/* Data directory */}
    <div className="border-t border-white/5 pt-4">
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
        Data directory <span className="text-zinc-600 font-normal">(optional)</span>
      </label>
      {savedBaseDir && (
        <p className="text-xs text-emerald-400 font-mono mb-2 flex items-center gap-1.5">
          <CheckCircle size={11} weight="fill" />
          {savedBaseDir}
        </p>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            type="text"
            value={baseDirInput}
            onChange={(e) => setBaseDirInput(e.target.value)}
            placeholder={savedBaseDir ?? "e.g. ~/Documents/ComfyUI"}
            className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
        <button
          disabled={!baseDirInput.trim() || saveBaseDirMutation.isPending}
          onClick={() => saveBaseDirMutation.mutate(baseDirInput.trim())}
          className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {baseDirSaved ? "Saved ✓" : "Save"}
        </button>
        {savedBaseDir && (
          <button
            disabled={saveBaseDirMutation.isPending}
            onClick={() => saveBaseDirMutation.mutate("")}
            className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors disabled:opacity-40"
            title="Clear override"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-[11px] text-zinc-600 mt-1.5">
        Passed as <span className="font-mono">--base-directory</span> to main.py. Leave blank to use the installation path.
      </p>
    </div>

    {/* Additional scan ports */}
    <div className="border-t border-white/5 pt-4">
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
        Additional ports to scan <span className="text-zinc-600 font-normal">(optional)</span>
      </label>
      {extraPorts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {extraPorts.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded">
              :{p}
              <button
                onClick={() => saveExtraPortsMutation.mutate(extraPorts.filter((x) => x !== p))}
                disabled={saveExtraPortsMutation.isPending}
                className="text-emerald-400/60 hover:text-emerald-200 transition-colors"
              >×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="number"
          min={1024}
          max={65535}
          value={portInput}
          onChange={(e) => setPortInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addPort(); }}
          placeholder="e.g. 9000"
          className="flex-1 px-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
        />
        <button
          disabled={!portInput.trim() || saveExtraPortsMutation.isPending}
          onClick={addPort}
          className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
      {allScannedPorts.length > 0 && (
        <div className="mt-2 text-[11px] text-zinc-500">
          Scanning: <span className="font-mono text-zinc-400">{allScannedPorts.join(", ")}</span>
        </div>
      )}
    </div>

    {/* Custom launch scripts */}
    <div className="border-t border-white/5 pt-4">
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
        Custom launch scripts <span className="text-zinc-600 font-normal">(optional)</span>
      </label>
      <p className="text-[11px] text-zinc-600 mb-3">
        Register <span className="font-mono">.bat</span>, <span className="font-mono">.sh</span>, or <span className="font-mono">.ps1</span> scripts to use instead of AIOS&apos;s built-in launch. Assign one per instance via the dropdown on each instance row.
      </p>
      {customScripts.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {customScripts.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/50 border border-white/5">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs font-medium text-zinc-300 truncate">{s.label}</span>
                <span className="text-[10px] font-mono text-zinc-600 truncate">{s.path}</span>
              </div>
              <button
                onClick={() => removeScript(s.id)}
                className="ml-3 p-1 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                title="Remove script"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={scriptLabelInput}
          onChange={(e) => setScriptLabelInput(e.target.value)}
          placeholder="Label (e.g. RTX 4060 Ti)"
          className="w-32 px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors shrink-0"
        />
        <div className="relative flex-1">
          <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            type="text"
            value={scriptPathInput}
            onChange={(e) => setScriptPathInput(e.target.value)}
            placeholder="Path to .bat / .sh / .ps1"
            onKeyDown={(e) => { if (e.key === "Enter") addScript(); }}
            className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
        <button
          disabled={!scriptLabelInput.trim() || !scriptPathInput.trim() || saveCustomScriptsMutation.isPending}
          onClick={addScript}
          className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          Add
        </button>
      </div>
    </div>
  </div>
</Modal>
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck 2>&1 | grep "ComfyUITab"
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(main\)/settings/ComfyUITab.tsx
git commit -m "feat: Edit Configuration modal, remove Advanced paths accordion"
```

---

## Task 12: Blank setup state

**Files:**
- Modify: `apps/web/src/app/(main)/settings/ComfyUITab.tsx`

This task replaces the "Setup required" state with a proper 3-path onboarding wizard. The wizard is rendered by `ComfyUITab` when `comfyManage?.isSetup === false`.

- [ ] **Step 1: Add blank state types and state variables**

At the top of `ComfyUITab` function body, add:

```typescript
type SetupPhase =
  | "choose"
  | "configuring-desktop"
  | "configuring-custom"
  | "installing"
  | "detecting"
  | "done";

const [setupPhase, setSetupPhase] = useState<SetupPhase>("choose");
const [installLog, setInstallLog] = useState<string[]>([]);
const [installError, setInstallError] = useState("");

// Desktop App option state
const DESKTOP_DEFAULT_PATH = "/Applications/ComfyUI.app/Contents/Resources/ComfyUI";
const [desktopComfyPath, setDesktopComfyPath] = useState(DESKTOP_DEFAULT_PATH);
const [desktopUserDataPath, setDesktopUserDataPath] = useState("");
const [desktopPathValid, setDesktopPathValid] = useState<boolean | null>(null);
const [desktopPathValidating, setDesktopPathValidating] = useState(false);

// Custom path option state
const [customPath, setCustomPath] = useState("");
const [customPathValid, setCustomPathValid] = useState<boolean | null>(null);
const [customPathValidating, setCustomPathValidating] = useState(false);
const [resolvedCustomPath, setResolvedCustomPath] = useState("");
```

- [ ] **Step 2: Add helper functions for the blank state**

In `ComfyUITab` function body, add:

```typescript
const validatePath = async (
  pathStr: string,
  setValid: (v: boolean | null) => void,
  setValidating: (v: boolean) => void,
  onResolved?: (p: string) => void,
) => {
  if (!pathStr.trim()) { setValid(null); return; }
  setValidating(true);
  try {
    const res = await fetch(
      `/api/comfy/setup/validate-path?path=${encodeURIComponent(pathStr.trim())}`,
    );
    const data = await res.json() as { valid: boolean; resolvedPath?: string };
    setValid(data.valid);
    if (data.valid && data.resolvedPath && onResolved) onResolved(data.resolvedPath);
  } catch {
    setValid(false);
  } finally {
    setValidating(false);
  }
};

const saveComfySetup = async (installType: string, managedPath: string, desktopDataPath?: string) => {
  await fetch("/api/settings/comfyui-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      installType,
      managedPath,
      ...(desktopDataPath ? { desktopUserDataPath: desktopDataPath } : {}),
    }),
  });
};

const streamInstall = async (targetPath?: string): Promise<boolean> => {
  setInstallLog([]);
  setInstallError("");
  const res = await fetch("/api/comfy/setup/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(targetPath ? { targetPath } : {}),
  });
  if (!res.body) { setInstallError("No response body"); return false; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6)) as { msg?: string; done?: boolean; error?: string };
      if (payload.msg) setInstallLog((prev) => [...prev, payload.msg!]);
      if (payload.error) { setInstallError(payload.error); return false; }
      if (payload.done) return true;
    }
  }
  return true;
};

const [setupJustCompleted, setSetupJustCompleted] = useState(false);

const finishSetup = async () => {
  setSetupPhase("detecting");
  await fetch("/api/comfy/instances/detect", { method: "POST" });
  setSetupJustCompleted(true);
  setTimeout(() => setSetupJustCompleted(false), 5000);
  queryClient.invalidateQueries({ queryKey: ["comfy-manage"] });
  refetchManage();
};

// Auto-validate desktop path on mount
useEffect(() => {
  validatePath(
    DESKTOP_DEFAULT_PATH,
    setDesktopPathValid,
    setDesktopPathValidating,
    setDesktopComfyPath,
  );
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Add setup handler functions**

```typescript
const handleDesktopSetup = async () => {
  if (!desktopUserDataPath.trim()) { showError("Desktop user data path is required"); return; }
  setSetupPhase("installing");
  try {
    await saveComfySetup("desktop-app", desktopPathValid ? desktopComfyPath : "", desktopUserDataPath.trim());
    const ok = await streamInstall(desktopPathValid ? desktopComfyPath : undefined);
    if (!ok) return;
    await fetch("/api/comfy/setup/copy-assets", { method: "POST" });
    await finishSetup();
  } catch (err: unknown) {
    setInstallError(err instanceof Error ? err.message : "Setup failed");
  }
};

const handleInstallSetup = async () => {
  setSetupPhase("installing");
  try {
    await saveComfySetup("github", "");
    const ok = await streamInstall();
    if (!ok) return;
    await finishSetup();
  } catch (err: unknown) {
    setInstallError(err instanceof Error ? err.message : "Install failed");
  }
};

const handleCustomSetup = async () => {
  const pathToUse = resolvedCustomPath || customPath.trim();
  if (!pathToUse || !customPathValid) { showError("Enter a valid ComfyUI installation path"); return; }
  setSetupPhase("detecting");
  await saveComfySetup("custom", pathToUse);
  await finishSetup();
};
```

- [ ] **Step 4: Build the blank state JSX**

In `ComfyUITab`'s return, the outermost `<div className="px-10 pb-8">` currently renders the big card and conditionally shows "Setup required". Replace the rendering so that when `!comfyManage?.isSetup` we render the blank state:

The conditional already exists as:
```tsx
{!comfyManage?.isSetup && (
  <p className="text-xs text-zinc-600 mt-0.5">Setup required</p>
)}
```

Replace the entire `ComfyUITab` return with a conditional router at the top level:

```tsx
return (
  <div className="px-10 pb-8">
    {!comfyManage?.isSetup ? (
      // ── Blank Setup State ──────────────────────────────────────────────
      <div className="max-w-2xl">
        {setupPhase === "installing" && (
          <div className="p-5 rounded-xl border border-white/10 bg-[var(--color-background-panel)]">
            <div className="mb-3">
              <h3 className="font-tech text-sm font-semibold text-zinc-200">Installing ComfyUI</h3>
              <p className="text-xs text-zinc-500 mt-0.5">This may take a few minutes…</p>
            </div>
            <div className="rounded-lg bg-black/60 border border-white/5 p-3 max-h-64 overflow-auto">
              <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap">
                {installLog.join("\n") || "Starting…"}
              </pre>
            </div>
            {installError && (
              <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-950/30 border border-red-500/20">
                <Warning size={14} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{installError}</p>
              </div>
            )}
          </div>
        )}

        {setupPhase === "detecting" && (
          <div className="p-5 rounded-xl border border-white/10 bg-[var(--color-background-panel)] flex items-center gap-3">
            <CircleNotch size={18} className="animate-spin text-emerald-400 shrink-0" />
            <span className="text-sm text-zinc-300">Detecting GPUs and configuring instances…</span>
          </div>
        )}

        {(setupPhase === "choose" || setupPhase === "configuring-desktop" || setupPhase === "configuring-custom") && (
          <>
            <div className="mb-6">
              <h2 className="font-tech text-xl font-semibold text-zinc-100">Connect your ComfyUI Workspace</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Link your local ComfyUI installation to FlowScale AIOS to manage instances and orchestrate generative workflows.
              </p>
            </div>

            <div className="space-y-3">
              {/* Option A — ComfyUI Desktop App */}
              <div className={`p-4 rounded-xl border transition-colors ${setupPhase === "configuring-desktop" ? "border-emerald-500/30 bg-[var(--color-background-panel)]" : "border-white/8 bg-[var(--color-background-panel)]/50"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-zinc-200">ComfyUI Desktop App</span>
                      {desktopPathValid === true && (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle size={10} weight="fill" /> Detected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">Use your existing ComfyUI Desktop App installation.</p>
                  </div>
                  {setupPhase !== "configuring-desktop" && (
                    <button
                      onClick={() => setSetupPhase("configuring-desktop")}
                      className="px-3 py-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors shrink-0"
                    >
                      Select
                    </button>
                  )}
                </div>

                {setupPhase === "configuring-desktop" && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">ComfyUI App path</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <FolderOpen size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                          <input
                            type="text"
                            value={desktopComfyPath}
                            onChange={(e) => {
                              setDesktopComfyPath(e.target.value);
                              setDesktopPathValid(null);
                            }}
                            onBlur={() => validatePath(desktopComfyPath, setDesktopPathValid, setDesktopPathValidating, setDesktopComfyPath)}
                            className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                          />
                        </div>
                        {desktopPathValidating && <CircleNotch size={14} className="animate-spin text-zinc-500 self-center" />}
                        {desktopPathValid === true && <CheckCircle size={14} className="text-emerald-400 self-center" weight="fill" />}
                        {desktopPathValid === false && <span className="text-[10px] text-red-400 self-center">Not found</span>}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">
                        User data folder <span className="text-zinc-600">(models, custom_nodes, etc.)</span>
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <FolderOpen size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                          <input
                            type="text"
                            value={desktopUserDataPath}
                            onChange={(e) => setDesktopUserDataPath(e.target.value)}
                            placeholder="e.g. ~/Library/Application Support/ComfyUI"
                            className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                          />
                        </div>
                        {typeof window !== "undefined" && window.desktop?.dialog && (
                          <button
                            onClick={async () => {
                              const dir = await window.desktop!.dialog!.openDirectory();
                              if (dir) setDesktopUserDataPath(dir);
                            }}
                            className="px-2.5 py-1.5 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-600 transition-colors shrink-0"
                          >
                            Browse
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setSetupPhase("choose")} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Back</button>
                      <button
                        onClick={handleDesktopSetup}
                        disabled={!desktopUserDataPath.trim()}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg transition-colors"
                      >
                        Use Desktop App
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Option B — Install via AIOS */}
              <div className="p-4 rounded-xl border border-white/8 bg-[var(--color-background-panel)]/50">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-zinc-200 mb-1">Install via FlowScale AIOS</p>
                    <p className="text-xs text-zinc-500">Clone ComfyUI from GitHub into <span className="font-mono text-zinc-400">~/.flowscale/comfyui</span> and set it up automatically.</p>
                  </div>
                  <button
                    onClick={handleInstallSetup}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors shrink-0"
                  >
                    Install
                  </button>
                </div>
              </div>

              {/* Option C — Custom path */}
              <div className={`p-4 rounded-xl border transition-colors ${setupPhase === "configuring-custom" ? "border-emerald-500/30 bg-[var(--color-background-panel)]" : "border-white/8 bg-[var(--color-background-panel)]/50"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-zinc-200 mb-1">Existing Custom Installation</p>
                    <p className="text-xs text-zinc-500">Point AIOS to a ComfyUI folder you already have on disk.</p>
                  </div>
                  {setupPhase !== "configuring-custom" && (
                    <button
                      onClick={() => setSetupPhase("configuring-custom")}
                      className="px-3 py-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors shrink-0"
                    >
                      Select
                    </button>
                  )}
                </div>

                {setupPhase === "configuring-custom" && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">ComfyUI installation folder</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <FolderOpen size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                          <input
                            type="text"
                            value={customPath}
                            onChange={(e) => {
                              setCustomPath(e.target.value);
                              setCustomPathValid(null);
                              setResolvedCustomPath("");
                            }}
                            onBlur={() => validatePath(
                              customPath,
                              setCustomPathValid,
                              setCustomPathValidating,
                              setResolvedCustomPath,
                            )}
                            placeholder="/path/to/ComfyUI"
                            className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                          />
                        </div>
                        {typeof window !== "undefined" && window.desktop?.dialog && (
                          <button
                            onClick={async () => {
                              const dir = await window.desktop!.dialog!.openDirectory();
                              if (dir) {
                                setCustomPath(dir);
                                validatePath(dir, setCustomPathValid, setCustomPathValidating, setResolvedCustomPath);
                              }
                            }}
                            className="px-2.5 py-1.5 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-600 transition-colors shrink-0"
                          >
                            Browse
                          </button>
                        )}
                        {customPathValidating && <CircleNotch size={14} className="animate-spin text-zinc-500 self-center" />}
                        {customPathValid === true && <CheckCircle size={14} className="text-emerald-400 self-center" weight="fill" />}
                        {customPathValid === false && <span className="text-[10px] text-red-400 self-center whitespace-nowrap">Not a valid ComfyUI folder</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setSetupPhase("choose")} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Back</button>
                      <button
                        onClick={handleCustomSetup}
                        disabled={!customPathValid}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg transition-colors"
                      >
                        Connect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    ) : (
      // ── Active Dashboard ──────────────────────────────────────────────────
      // Move the EXISTING <div className="max-w-3xl"> card and the existing
      // <Modal> components (spawn-log viewer, external stop confirmation, and
      // the config modal added in Task 11) here verbatim. No content changes.
      <>
        {setupJustCompleted && (
          <div className="max-w-3xl mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
            <CheckCircle size={14} weight="fill" className="text-emerald-400 shrink-0" />
            ComfyUI connected — instances are ready. Start them below.
          </div>
        )}
        {/* Existing dashboard card: <div className="max-w-3xl"> ... </div> */}
        {/* Existing modals: spawn-log, external-stop, config */}
      </>
    )}
  </div>
);
```

The `{/* Existing dashboard card */}` and `{/* Existing modals */}` comments are placeholders in this document only — replace them with the actual JSX from `ComfyUITab.tsx` (the `<div className="max-w-3xl">` block and the three `<Modal>` components). No changes to their content.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 6: Run unit tests**

```bash
pnpm --filter @flowscale/aios-web test -- src/lib/__tests__/instanceLabel.test.ts src/lib/__tests__/providerSettings.test.ts
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(main\)/settings/ComfyUITab.tsx
git commit -m "feat: blank setup state with 3-path onboarding wizard"
```

---

## Task 13: Final typecheck and test run

- [ ] **Step 1: Full typecheck**

```bash
pnpm typecheck
```

Expected: exit 0, no errors

- [ ] **Step 2: Full unit test suite**

```bash
pnpm --filter @flowscale/aios-web test
```

Expected: all tests pass including the new instanceLabel and providerSettings tests

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: ComfyUI settings UX overhaul — onboarding wizard, instance management improvements"
```
