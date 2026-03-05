import { describe, it, expect, vi } from 'vitest'
import { useNotificationStore } from '../notificationStore'

describe('useNotificationStore', () => {
  it('returns an object with addNotification', () => {
    const store = useNotificationStore()
    expect(typeof store.addNotification).toBe('function')
  })

  it('logs success notifications to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { addNotification } = useNotificationStore()
    addNotification({ type: 'success', title: 'Done', message: 'All good' })
    expect(spy).toHaveBeenCalledWith('[✓] Done: All good')
    spy.mockRestore()
  })

  it('logs error notifications to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { addNotification } = useNotificationStore()
    addNotification({ type: 'error', title: 'Failed', message: 'Something broke' })
    expect(spy).toHaveBeenCalledWith('[✗] Failed: Something broke')
    spy.mockRestore()
  })

  it('logs info notifications to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { addNotification } = useNotificationStore()
    addNotification({ type: 'info', title: 'Note' })
    expect(spy).toHaveBeenCalledWith('[i] Note')
    spy.mockRestore()
  })

  it('logs warning notifications to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { addNotification } = useNotificationStore()
    addNotification({ type: 'warning', title: 'Watch out' })
    expect(spy).toHaveBeenCalledWith('[i] Watch out')
    spy.mockRestore()
  })

  it('handles notifications without message', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { addNotification } = useNotificationStore()
    addNotification({ type: 'success', title: 'Quick' })
    expect(spy).toHaveBeenCalledWith('[✓] Quick')
    spy.mockRestore()
  })
})
