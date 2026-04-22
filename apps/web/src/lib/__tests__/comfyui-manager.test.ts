import { describe, it, expect } from 'vitest'
import { buildScriptSpawnArgs } from '../comfyui-manager'

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
