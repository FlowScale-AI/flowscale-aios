import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `training-test-${Date.now()}`)

vi.mock('os', async () => {
  const actual = await vi.importActual('os')
  return { ...actual, homedir: () => TEST_DIR }
})

import {
  createDataset,
  listDatasets,
  getDataset,
  updateDatasetMeta,
  deleteDataset,
  getDatasetsDir,
} from '../training'

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('createDataset', () => {
  it('creates dataset directory with meta.json', () => {
    const ds = createDataset({ name: 'my-faces', triggerWord: 'ohwx' })
    expect(ds.id).toBeTruthy()
    expect(ds.name).toBe('my-faces')
    expect(existsSync(join(getDatasetsDir(), ds.id, 'meta.json'))).toBe(true)
  })
})

describe('listDatasets', () => {
  it('returns empty array when no datasets exist', () => {
    expect(listDatasets()).toEqual([])
  })

  it('returns created datasets', () => {
    createDataset({ name: 'ds1', triggerWord: 'tok1' })
    createDataset({ name: 'ds2', triggerWord: 'tok2' })
    expect(listDatasets()).toHaveLength(2)
  })
})

describe('getDataset', () => {
  it('returns dataset with image list', () => {
    const ds = createDataset({ name: 'test', triggerWord: 'ohwx' })
    const dsDir = join(getDatasetsDir(), ds.id)
    writeFileSync(join(dsDir, 'img_01.jpg'), 'fake')
    writeFileSync(join(dsDir, 'img_01.txt'), 'a photo')

    const result = getDataset(ds.id)
    expect(result).toBeTruthy()
    expect(result!.images).toHaveLength(1)
    expect(result!.images[0].name).toBe('img_01.jpg')
    expect(result!.images[0].caption).toBe('a photo')
  })
})

describe('updateDatasetMeta', () => {
  it('updates trigger word', () => {
    const ds = createDataset({ name: 'test', triggerWord: 'ohwx' })
    updateDatasetMeta(ds.id, { triggerWord: 'sks' })
    const updated = getDataset(ds.id)
    expect(updated!.triggerWord).toBe('sks')
  })
})

describe('deleteDataset', () => {
  it('removes dataset directory', () => {
    const ds = createDataset({ name: 'test', triggerWord: 'ohwx' })
    deleteDataset(ds.id)
    expect(existsSync(join(getDatasetsDir(), ds.id))).toBe(false)
  })
})
