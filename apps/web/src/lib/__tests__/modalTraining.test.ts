import { describe, it, expect } from 'vitest'
import { buildDatasetSyncArgs, buildTrainingPayload, parseProgressLine } from '../modalTraining'

describe('buildDatasetSyncArgs', () => {
  it('returns correct args for sync-dataset command', () => {
    const args = buildDatasetSyncArgs('/home/user/.flowscale/training-datasets/abc123', 'abc123')
    expect(args).toEqual(['sync-dataset', '/home/user/.flowscale/training-datasets/abc123', 'abc123', 'flowscale-training-datasets'])
  })
})

describe('buildTrainingPayload', () => {
  it('builds payload from tool inputs', () => {
    const inputs = {
      'api__datasetId': 'abc123',
      'api__outputName': 'my-lora',
      'api__triggerWord': 'ohwx',
      'api__steps': 1000,
      'api__lr': '1e-4',
      'api__rank': 128,
      'api__resolution': 1024,
    }
    const payload = buildTrainingPayload(inputs)
    expect(payload).toEqual({
      datasetId: 'abc123',
      outputName: 'my-lora',
      triggerWord: 'ohwx',
      steps: 1000,
      lr: '1e-4',
      rank: 128,
      resolution: 1024,
    })
  })

  it('uses defaults for missing optional fields', () => {
    const inputs = {
      'api__datasetId': 'abc123',
      'api__outputName': 'my-lora',
    }
    const payload = buildTrainingPayload(inputs)
    expect(payload.triggerWord).toBe('ohwx')
    expect(payload.steps).toBe(1000)
    expect(payload.rank).toBe(128)
  })

  it('throws if datasetId is missing', () => {
    expect(() => buildTrainingPayload({ 'api__outputName': 'x' })).toThrow('datasetId is required')
  })

  it('throws if outputName is missing', () => {
    expect(() => buildTrainingPayload({ 'api__datasetId': 'x' })).toThrow('outputName is required')
  })
})

describe('parseProgressLine', () => {
  it('parses a PROGRESS line', () => {
    const line = 'PROGRESS:{"step":50,"totalSteps":1000,"pct":5,"message":"step 50"}'
    const result = parseProgressLine(line)
    expect(result).toEqual({ type: 'progress', data: { step: 50, totalSteps: 1000, pct: 5, message: 'step 50' } })
  })

  it('parses a RESULT line with completed status', () => {
    const line = 'RESULT:{"status":"completed","outputVolumePath":"/outputs/abc/my-lora.safetensors"}'
    const result = parseProgressLine(line)
    expect(result).toEqual({ type: 'result', data: { status: 'completed', outputVolumePath: '/outputs/abc/my-lora.safetensors' } })
  })

  it('parses a RESULT line with failed status', () => {
    const line = 'RESULT:{"status":"failed","error":"Dataset not found"}'
    const result = parseProgressLine(line)
    expect(result).toEqual({ type: 'result', data: { status: 'failed', error: 'Dataset not found' } })
  })

  it('returns null for non-protocol lines', () => {
    expect(parseProgressLine('[ai-toolkit] Loading model...')).toBeNull()
    expect(parseProgressLine('')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseProgressLine('PROGRESS:{bad json')).toBeNull()
  })
})
