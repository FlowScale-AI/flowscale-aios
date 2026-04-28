import { describe, it, expect } from 'vitest'
import {
  buildScriptSpawnArgs,
  normalizeGpuName,
  shouldConflict,
  buildLocalGpuList,
  normalizeStoredComfyPath,
} from '../comfyui-manager'

describe('buildScriptSpawnArgs', () => {
  it('spawns .sh via sh on linux', () => {
    expect(buildScriptSpawnArgs('/home/user/run.sh', 'linux')).toEqual({
      cmd: 'sh',
      args: ['/home/user/run.sh'],
    })
  })

  it('spawns .bat via cmd.exe on windows', () => {
    expect(buildScriptSpawnArgs('C:\\ComfyUI\\run.bat', 'win32')).toEqual({
      cmd: 'cmd.exe',
      args: ['/c', 'C:\\ComfyUI\\run.bat'],
    })
  })

  it('spawns .ps1 via powershell on windows', () => {
    expect(buildScriptSpawnArgs('C:\\ComfyUI\\run.ps1', 'win32')).toEqual({
      cmd: 'powershell.exe',
      args: ['-ExecutionPolicy', 'Bypass', '-File', 'C:\\ComfyUI\\run.ps1'],
    })
  })

  it('spawns .sh via sh on mac', () => {
    expect(buildScriptSpawnArgs('/Users/me/run.sh', 'darwin')).toEqual({
      cmd: 'sh',
      args: ['/Users/me/run.sh'],
    })
  })

  it('spawns extensionless file directly', () => {
    expect(buildScriptSpawnArgs('/usr/local/bin/comfy-start', 'linux')).toEqual({
      cmd: '/usr/local/bin/comfy-start',
      args: [],
    })
  })
})

describe('normalizeGpuName', () => {
  it('strips (TM) marker', () => {
    expect(normalizeGpuName('AMD Radeon(TM) Graphics')).toBe('amd radeon graphics')
  })

  it('strips ™ unicode marker', () => {
    expect(normalizeGpuName('NVIDIA GeForce RTX™ 4090')).toBe('nvidia geforce rtx 4090')
  })

  it('lowercases and collapses whitespace', () => {
    expect(normalizeGpuName('  AMD   Radeon   RX 7700 XT  ')).toBe('amd radeon rx 7700 xt')
  })

  it('matches registry "(TM)" form to torch form', () => {
    expect(normalizeGpuName('AMD Radeon(TM) RX 7700 XT')).toBe(
      normalizeGpuName('AMD Radeon RX 7700 XT'),
    )
  })

  it('returns empty string for undefined / null', () => {
    expect(normalizeGpuName(undefined)).toBe('')
    expect(normalizeGpuName('')).toBe('')
  })

  it('strips ComfyUI Desktop "cuda:N <name> : <mode>" wrapping (the field-reported regression)', () => {
    // Real string from ComfyUI Desktop's /system_stats:
    expect(normalizeGpuName('cuda:0 AMD Radeon RX 7700 XT : native')).toBe(
      'amd radeon rx 7700 xt',
    )
    expect(normalizeGpuName('rocm:1 AMD Radeon RX 7700 XT : compiled')).toBe(
      'amd radeon rx 7700 xt',
    )
    expect(normalizeGpuName('hip:0 AMD Radeon Pro VII : eager')).toBe(
      'amd radeon pro vii',
    )
  })

  it('Desktop-wrapped name normalizes equal to torch-reported name', () => {
    expect(normalizeGpuName('cuda:0 AMD Radeon RX 7700 XT : native')).toBe(
      normalizeGpuName('AMD Radeon RX 7700 XT'),
    )
  })

  it('Desktop wrap + (TM) all stripped together', () => {
    expect(normalizeGpuName('cuda:0 AMD Radeon(TM) RX 7700 XT : native')).toBe(
      'amd radeon rx 7700 xt',
    )
  })

  it('does not strip a trailing colon-word when there is no leading space (false positive guard)', () => {
    // "Foo:bar" should not be treated as the runtime-tag pattern, which requires
    // " : " with surrounding spaces. Tightens the regex against names that
    // legitimately contain a colon.
    expect(normalizeGpuName('Some:GPU')).toBe('some:gpu')
  })
})

describe('shouldConflict', () => {
  // Realistic local-GPU layout from the field-reported case: AMD iGPU at
  // rocm:0, discrete 7700 XT at rocm:1.
  const localGpus = [
    { index: 0, name: 'AMD Radeon(TM) Graphics' },
    { index: 1, name: 'AMD Radeon RX 7700 XT' },
  ]

  describe('GPU instance with full local + external naming', () => {
    it('flags conflict when external name matches the AIOS target (env-isolated index)', () => {
      // Desktop on the 7700 XT reports its only device as cuda:0 because of
      // HIP_VISIBLE_DEVICES, even though physically it's GPU index 1.
      // Starting AIOS rocm:1 must conflict.
      const external = [{ type: 'cuda', index: 0, name: 'AMD Radeon RX 7700 XT' }]
      expect(shouldConflict('rocm:1', external, localGpus)).toBe(true)
    })

    it('does NOT conflict when external is on a different GPU than the AIOS target', () => {
      // Desktop on the 7700 XT (cuda:0 "AMD Radeon RX 7700 XT").
      // Starting AIOS rocm:0 (the iGPU) must NOT conflict — different cards.
      const external = [{ type: 'cuda', index: 0, name: 'AMD Radeon RX 7700 XT' }]
      expect(shouldConflict('rocm:0', external, localGpus)).toBe(false)
    })

    it('flags conflict on direct index match without env isolation', () => {
      const external = [{ type: 'cuda', index: 1, name: 'AMD Radeon RX 7700 XT' }]
      expect(shouldConflict('rocm:1', external, localGpus)).toBe(true)
    })

    it('handles "(TM)" naming differences between sides', () => {
      // Local registry says "(TM)", external torch doesn't.
      const external = [{ type: 'cuda', index: 0, name: 'AMD Radeon Graphics' }]
      expect(shouldConflict('rocm:0', external, localGpus)).toBe(true)
    })
  })

  describe('GPU instance fallbacks when local GPU info is unavailable', () => {
    it('does NOT false-conflict on env-isolated single GPU when no local GPU info', () => {
      // Field-reported regression: external is Desktop on the 7700 XT, reports
      // its only device as cuda:0 (env-isolated). detectGpus() returned [] so
      // we have no local mapping. Previous logic would conflict on ANY GPU
      // target — including the iGPU — because cuda:0 looked like physical 0.
      // With names available on the external side but no local truth, we
      // cannot say which physical card it's on, so don't block.
      const external = [{ type: 'cuda', index: 0, name: 'AMD Radeon RX 7700 XT' }]
      expect(shouldConflict('rocm:0', external, [])).toBe(false)
    })

    it('flags conflict on multi-GPU external with direct index match (no local info)', () => {
      // Multi-device external is not env-isolated, so its indices are real.
      const external = [
        { type: 'cuda', index: 0, name: 'GPU A' },
        { type: 'cuda', index: 1, name: 'GPU B' },
      ]
      expect(shouldConflict('rocm:1', external, [])).toBe(true)
    })

    it('does not conflict when external reports many GPUs and none match index', () => {
      const external = [
        { type: 'cuda', index: 0, name: 'GPU A' },
        { type: 'cuda', index: 2, name: 'GPU B' },
      ]
      expect(shouldConflict('rocm:1', external, [])).toBe(false)
    })

    it('flags conflict on direct index match when external is unnamed (legacy ComfyUI)', () => {
      // Old ComfyUI builds didn't include name in /system_stats. We can only
      // go by index in that case — assume it's not env-isolated.
      const external = [{ type: 'cuda', index: 1 }]
      expect(shouldConflict('rocm:1', external, [])).toBe(true)
    })

    it('does NOT conflict on env-isolated single GPU when external is unnamed and no local info', () => {
      // Single device, unnamed, index 0. We have no signal at all → don't block.
      const external = [{ type: 'cuda', index: 0 }]
      expect(shouldConflict('rocm:1', external, [])).toBe(false)
    })
  })

  describe('CPU instance', () => {
    it('flags conflict when external is CPU-only', () => {
      const external = [{ type: 'cpu', index: 0, name: 'CPU' }]
      expect(shouldConflict('cpu', external, localGpus)).toBe(true)
    })

    it('does not conflict when external is GPU-only', () => {
      const external = [{ type: 'cuda', index: 0, name: 'AMD Radeon RX 7700 XT' }]
      expect(shouldConflict('cpu', external, localGpus)).toBe(false)
    })

    it('does not conflict when external reports no devices', () => {
      expect(shouldConflict('cpu', [], localGpus)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('returns false for an unparseable device target', () => {
      const external = [{ type: 'cuda', index: 0, name: 'Anything' }]
      expect(shouldConflict('rocm:notanumber', external, localGpus)).toBe(false)
    })

    it('returns false when external reports no non-CPU devices', () => {
      const external = [{ type: 'cpu', index: 0, name: 'CPU' }]
      expect(shouldConflict('rocm:1', external, localGpus)).toBe(false)
    })

    it('does not falsely conflict when target name matches a different local GPU', () => {
      // External is on the iGPU; AIOS wants the discrete. Target name is
      // 7700 XT, external name is iGPU. Both names exist in localGpus, so
      // we know external is on the iGPU → no conflict for rocm:1.
      const external = [{ type: 'cuda', index: 0, name: 'AMD Radeon Graphics' }]
      expect(shouldConflict('rocm:1', external, localGpus)).toBe(false)
    })
  })
})

describe('buildLocalGpuList', () => {
  it('returns detected list as-is when all indices are detected', () => {
    const detected = [
      { index: 0, name: 'AMD Radeon(TM) Graphics' },
      { index: 1, name: 'AMD Radeon RX 7700 XT' },
    ]
    const instances = [
      { device: 'rocm:0', gpuName: 'AMD Radeon Graphics' },
      { device: 'rocm:1', gpuName: 'AMD Radeon RX 7700 XT' },
    ]
    expect(buildLocalGpuList(detected, instances)).toEqual(detected)
  })

  it('falls back to instance config when detection returned empty (the field-reported case)', () => {
    // detectGpus() was poisoned by an early-startup empty result. Conflict
    // check would have had no local info — now it pulls from instance configs.
    const instances = [
      { device: 'rocm:0', gpuName: 'AMD Radeon(TM) Graphics' },
      { device: 'rocm:1', gpuName: 'AMD Radeon RX 7700 XT' },
      { device: 'cpu', gpuName: undefined },
    ]
    expect(buildLocalGpuList([], instances)).toEqual([
      { index: 0, name: 'AMD Radeon(TM) Graphics' },
      { index: 1, name: 'AMD Radeon RX 7700 XT' },
    ])
  })

  it('skips CPU instances and instances without gpuName', () => {
    const instances = [
      { device: 'cpu', gpuName: 'something' },
      { device: 'cuda:0', gpuName: undefined },
      { device: 'cuda:1', gpuName: 'RTX 4090' },
    ]
    expect(buildLocalGpuList([], instances)).toEqual([
      { index: 1, name: 'RTX 4090' },
    ])
  })

  it('prefers detected entries over instance config for the same index', () => {
    const detected = [{ index: 0, name: 'Detected Name' }]
    const instances = [{ device: 'rocm:0', gpuName: 'Stale Name' }]
    expect(buildLocalGpuList(detected, instances)).toEqual([
      { index: 0, name: 'Detected Name' },
    ])
  })

  it('merges: detected fills some, instance config fills the rest', () => {
    const detected = [{ index: 0, name: 'GPU 0 Detected' }]
    const instances = [
      { device: 'rocm:0', gpuName: 'GPU 0 Stale' },
      { device: 'rocm:1', gpuName: 'GPU 1 From Config' },
    ]
    expect(buildLocalGpuList(detected, instances)).toEqual([
      { index: 0, name: 'GPU 0 Detected' },
      { index: 1, name: 'GPU 1 From Config' },
    ])
  })

  it('ignores instance configs with malformed device strings', () => {
    const instances = [
      { device: 'gpu-something', gpuName: 'Garbage' },
      { device: 'cuda:abc', gpuName: 'AlsoGarbage' },
      { device: 'cuda:2', gpuName: 'Real GPU' },
    ]
    expect(buildLocalGpuList([], instances)).toEqual([
      { index: 2, name: 'Real GPU' },
    ])
  })
})

describe('normalizeStoredComfyPath', () => {
  it('returns empty for empty input', () => {
    expect(normalizeStoredComfyPath('')).toBe('')
    expect(normalizeStoredComfyPath('   ')).toBe('')
  })

  it('strips trailing main.py from stale settings (the field-reported regression)', () => {
    expect(
      normalizeStoredComfyPath('C:\\Users\\rupay\\AppData\\Local\\Programs\\ComfyUI\\resources\\ComfyUI\\main.py'),
    ).toBe('C:\\Users\\rupay\\AppData\\Local\\Programs\\ComfyUI\\resources\\ComfyUI')
  })

  it('strips trailing main.py case-insensitively', () => {
    expect(normalizeStoredComfyPath('/home/u/ComfyUI/MAIN.PY')).toBe('/home/u/ComfyUI')
  })

  it('strips trailing separators', () => {
    expect(normalizeStoredComfyPath('/home/u/ComfyUI/')).toBe('/home/u/ComfyUI')
    expect(normalizeStoredComfyPath('C:\\path\\\\')).toBe('C:\\path')
  })

  it('strips wrapping quotes', () => {
    expect(normalizeStoredComfyPath('"C:\\path\\ComfyUI"')).toBe('C:\\path\\ComfyUI')
    expect(normalizeStoredComfyPath("'/home/u/ComfyUI'")).toBe('/home/u/ComfyUI')
  })

  it('passes a clean path through unchanged', () => {
    expect(normalizeStoredComfyPath('/home/u/ComfyUI')).toBe('/home/u/ComfyUI')
  })

  it('does not strip filenames that merely contain main.py', () => {
    expect(normalizeStoredComfyPath('/home/u/main.pyc')).toBe('/home/u/main.pyc')
    expect(normalizeStoredComfyPath('/home/u/notmain.py')).toBe('/home/u/notmain.py')
  })
})

describe('end-to-end: field-reported scenarios', () => {
  describe('legacy layout: iGPU at rocm:0, discrete at rocm:1', () => {
    // Reproduces the original problem: detectGpus() returned [] (so localGpus
    // came purely from instance config), Desktop on the 7700 XT shows up as
    // cuda:0 because of HIP_VISIBLE_DEVICES isolation.
    const instances = [
      { device: 'rocm:0', gpuName: 'AMD Radeon(TM) Graphics' },
      { device: 'rocm:1', gpuName: 'AMD Radeon RX 7700 XT' },
      { device: 'cpu', gpuName: undefined },
    ]
    const localGpus = buildLocalGpuList([], instances)
    const desktopOn7700XT = [{ type: 'cuda', index: 0, name: 'AMD Radeon RX 7700 XT' }]

    it('blocks AIOS gpu-1 (rocm:1) from spawning on top of Desktop App on 7700 XT', () => {
      expect(shouldConflict('rocm:1', desktopOn7700XT, localGpus)).toBe(true)
    })

    it('does NOT block AIOS gpu-0 (rocm:0, iGPU) when Desktop App is on the 7700 XT', () => {
      expect(shouldConflict('rocm:0', desktopOn7700XT, localGpus)).toBe(false)
    })

    it('does NOT block AIOS cpu when Desktop App is on a GPU', () => {
      expect(shouldConflict('cpu', desktopOn7700XT, localGpus)).toBe(false)
    })
  })

  describe('post-sort layout: discrete at rocm:0, only GPU detected by torch', () => {
    // After the parseAmdGpusFromRegistry sort fix + re-detect, HIP only
    // exposes the 7700 XT (iGPU isn't HIP-supported), so detectGpus returns
    // a single entry at index 0. The only AIOS GPU instance is gpu-0 →
    // rocm:0 → 7700 XT. Desktop is also on the 7700 XT, port 8000.
    // Starting AIOS gpu-0 must conflict.
    const localGpus = buildLocalGpuList(
      [{ index: 0, name: 'AMD Radeon RX 7700 XT' }],
      [
        { device: 'rocm:0', gpuName: 'AMD Radeon RX 7700 XT' },
        { device: 'cpu', gpuName: undefined },
      ],
    )
    const desktopOn7700XT = [{ type: 'cuda', index: 0, name: 'AMD Radeon RX 7700 XT' }]

    it('blocks AIOS gpu-0 when Desktop App is on the same 7700 XT (post-sort layout)', () => {
      expect(shouldConflict('rocm:0', desktopOn7700XT, localGpus)).toBe(true)
    })

    it('still allows CPU instance', () => {
      expect(shouldConflict('cpu', desktopOn7700XT, localGpus)).toBe(false)
    })

    it('regression: works even when detectGpus returned [] but instance config has gpuName', () => {
      // Same scenario but detection failed at conflict-check time. Instance
      // config still has the GPU name from original setup.
      const fallbackLocalGpus = buildLocalGpuList(
        [],
        [
          { device: 'rocm:0', gpuName: 'AMD Radeon RX 7700 XT' },
          { device: 'cpu', gpuName: undefined },
        ],
      )
      expect(shouldConflict('rocm:0', desktopOn7700XT, fallbackLocalGpus)).toBe(true)
    })

    it('REGRESSION: blocks when Desktop reports the wrapped "cuda:0 <name> : native" format', () => {
      // ComfyUI Desktop's /system_stats actually returns the device name
      // with backend prefix and runtime suffix wrapping it. Without
      // normalizeGpuName stripping that wrapping, the conflict check
      // failed silently — the bug the user hit.
      const desktopWrappedName = [
        { type: 'cuda', index: 0, name: 'cuda:0 AMD Radeon RX 7700 XT : native' },
      ]
      expect(shouldConflict('rocm:0', desktopWrappedName, localGpus)).toBe(true)
    })

    it('REGRESSION: still does not block iGPU when Desktop is on 7700 XT (wrapped name)', () => {
      // The flip side — the wrapping must still preserve the "different GPU
      // → no conflict" decision when the iGPU is being targeted.
      const localGpusWithBoth = buildLocalGpuList(
        [
          { index: 0, name: 'AMD Radeon RX 7700 XT' },
          { index: 1, name: 'AMD Radeon(TM) Graphics' },
        ],
        [],
      )
      const desktopWrappedName = [
        { type: 'cuda', index: 0, name: 'cuda:0 AMD Radeon RX 7700 XT : native' },
      ]
      expect(shouldConflict('rocm:1', desktopWrappedName, localGpusWithBoth)).toBe(false)
    })
  })
})
