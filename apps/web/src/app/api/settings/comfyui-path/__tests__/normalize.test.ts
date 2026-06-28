import { describe, it, expect } from 'vitest'
import { normalizeComfyPathInput } from '../normalize'

describe('normalizeComfyPathInput', () => {
  it('returns empty for empty / whitespace-only / undefined input', () => {
    expect(normalizeComfyPathInput('')).toBe('')
    expect(normalizeComfyPathInput('   ')).toBe('')
    expect(normalizeComfyPathInput(undefined as unknown as string)).toBe('')
  })

  it('passes a clean Windows path through unchanged', () => {
    expect(
      normalizeComfyPathInput('C:\\Users\\rupay\\AppData\\Local\\Programs\\ComfyUI\\resources\\ComfyUI'),
    ).toBe('C:\\Users\\rupay\\AppData\\Local\\Programs\\ComfyUI\\resources\\ComfyUI')
  })

  it('passes a clean Unix path through unchanged', () => {
    expect(normalizeComfyPathInput('/Applications/ComfyUI.app/Contents/Resources/ComfyUI')).toBe(
      '/Applications/ComfyUI.app/Contents/Resources/ComfyUI',
    )
  })

  it('strips trailing main.py on Windows (the field-reported case)', () => {
    expect(
      normalizeComfyPathInput('C:\\Users\\rupay\\AppData\\Local\\Programs\\ComfyUI\\resources\\ComfyUI\\main.py'),
    ).toBe('C:\\Users\\rupay\\AppData\\Local\\Programs\\ComfyUI\\resources\\ComfyUI')
  })

  it('strips trailing main.py on Unix', () => {
    expect(normalizeComfyPathInput('/home/user/ComfyUI/main.py')).toBe('/home/user/ComfyUI')
  })

  it('strips trailing main.py case-insensitively', () => {
    expect(normalizeComfyPathInput('/home/user/ComfyUI/MAIN.PY')).toBe('/home/user/ComfyUI')
  })

  it('strips trailing separators', () => {
    expect(normalizeComfyPathInput('/home/user/ComfyUI/')).toBe('/home/user/ComfyUI')
    expect(normalizeComfyPathInput('C:\\path\\ComfyUI\\')).toBe('C:\\path\\ComfyUI')
    expect(normalizeComfyPathInput('C:\\path\\ComfyUI\\\\')).toBe('C:\\path\\ComfyUI')
  })

  it('strips wrapping double quotes (Windows "Copy as path")', () => {
    expect(
      normalizeComfyPathInput('"C:\\Users\\rupay\\AppData\\Local\\Programs\\ComfyUI"'),
    ).toBe('C:\\Users\\rupay\\AppData\\Local\\Programs\\ComfyUI')
  })

  it('strips wrapping single quotes', () => {
    expect(normalizeComfyPathInput("'/home/user/ComfyUI'")).toBe('/home/user/ComfyUI')
  })

  it('does not strip embedded quotes (only wrapping ones)', () => {
    expect(normalizeComfyPathInput('/home/"weird"/ComfyUI')).toBe('/home/"weird"/ComfyUI')
  })

  it('handles trailing main.py + trailing slash + outer quotes together', () => {
    expect(normalizeComfyPathInput('  "/home/user/ComfyUI/main.py"  ')).toBe('/home/user/ComfyUI')
  })

  it('does NOT strip main.py that is part of a longer name', () => {
    // Should only strip a literal "/main.py" or "\main.py" suffix.
    expect(normalizeComfyPathInput('/home/user/notmain.py')).toBe('/home/user/notmain.py')
    expect(normalizeComfyPathInput('/home/user/main.pyc')).toBe('/home/user/main.pyc')
  })

  it('does not collapse legitimate trailing separators on root paths', () => {
    // Root "/" becomes "" — this is fine; the validator will reject it as
    // "not a valid ComfyUI install" anyway.
    expect(normalizeComfyPathInput('/')).toBe('')
  })
})
