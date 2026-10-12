import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runtimeBinary } from '../../src/main/assets/media-probe'

test('real desktop imports WAV, persists favorites and playlist ordering on restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-library-desktop-'))
  const data = join(directory, 'userData')
  const paths = await Promise.all([440, 880].map((toneHz, index) => makeAudioFile({ directory, name: `旋律 ${index}🎵.wav`, durationSeconds: 0.5, toneHz })))
  const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
  const originals = await Promise.all(paths.map(hash))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    desktop = await launchApp(data)
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected }) }, paths)
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await expect(desktop.page.getByRole('row')).toHaveCount(3)
    await desktop.page.getByRole('button', { name: '收藏 旋律 0🎵', exact: true }).click()
    await desktop.page.getByRole('button', { name: '新建播放列表', exact: true }).click()
    await desktop.page.getByRole('textbox', { name: '歌单名称' }).fill('旅途')
    await desktop.page.getByRole('button', { name: '创建歌单', exact: true }).click()
    await desktop.page.getByRole('combobox', { name: '添加 旋律 0🎵 到歌单' }).selectOption({ label: '旅途' })
    await desktop.page.getByRole('combobox', { name: '添加 旋律 1🎵 到歌单' }).selectOption({ label: '旅途' })
    await desktop.page.getByRole('button', { name: '旅途', exact: true }).click()
    await desktop.page.getByRole('button', { name: '上移 旋律 1🎵' }).click()
    await expect(desktop.page.getByRole('row').nth(1)).toContainText('旋律 1🎵')
    await desktop.page.screenshot({ path: '.superpowers/sdd/2026-10-03-music-player-implementation/task-2-ui.png' })
    await desktop.app.close(); desktop = await launchApp(data)
    await desktop.page.getByRole('button', { name: '收藏', exact: true }).click()
    await expect(desktop.page.getByRole('row')).toHaveCount(2)
    await expect(desktop.page.getByRole('row').nth(1)).toContainText('旋律 0🎵')
    await desktop.page.getByRole('button', { name: '旅途', exact: true }).click()
    await expect(desktop.page.getByRole('row').nth(1)).toContainText('旋律 1🎵')
    await expect(desktop.page.getByRole('row').nth(2)).toContainText('旋律 0🎵')
    const dto = await desktop.page.evaluate(() => window.musicApp.library.list())
    expect(JSON.stringify(dto)).not.toContain(directory)
    const asset = await desktop.page.evaluate(async () => {
      const snapshot = await window.musicApp.library.list()
      const url = window.musicApp.assets.url(snapshot.tracks[0].audioAssetId!)
      const response = await fetch(url, { headers: { Range: 'bytes=0-43' } })
      return { status: response.status, length: (await response.arrayBuffer()).byteLength, range: response.headers.get('content-range') }
    })
    expect(asset).toEqual({ status: 206, length: 44, range: 'bytes 0-43/44144' })
    expect(await Promise.all(paths.map(hash))).toEqual(originals)
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
})

test('real Electron folder dialog and webUtils File drop import local files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-desktop-drop-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const folder = join(directory, '文件夹 🎵')
    await makeAudioFile({ directory: folder, name: '文件夹歌曲.wav', durationSeconds: 0.2, toneHz: 220 })
    const dropped = await makeAudioFile({ directory, name: '拖入歌曲.wav', durationSeconds: 0.2, toneHz: 330 })
    desktop = await launchApp(join(directory, 'data'))
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, folder)
    await desktop.page.getByRole('button', { name: '导入文件夹', exact: true }).click()
    await expect(desktop.page.getByRole('row')).toHaveCount(2)
    await desktop.page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'test-native-file'; document.body.append(input) })
    await desktop.page.locator('#test-native-file').setInputFiles(dropped)
    await desktop.page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#test-native-file')!
      const data = new DataTransfer(); data.items.add(input.files![0])
      document.querySelector('.app-shell')!.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
      input.remove()
    })
    await expect(desktop.page.getByRole('row')).toHaveCount(3)
    await expect(desktop.page.getByRole('row').nth(2)).toContainText('拖入歌曲')
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
})

test('real library shows raw explicit version evidence after desktop restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-version-display-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const wav = await makeAudioFile({ directory, name: 'source.wav', durationSeconds: 0.2, toneHz: 440 })
    const tagged = join(directory, 'raw-evidence.flac'); const raw = 'Ｌｉｖｅ at 上海 2026 🎵'
    await promisify(execFile)(runtimeBinary('ffmpeg'), ['-v', 'error', '-y', '-i', wav, '-metadata', 'title=Live Forever', '-metadata', `comment=${raw}`, tagged])
    const data = join(directory, 'data'); desktop = await launchApp(data)
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, tagged)
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await expect(desktop.page.getByText(raw, { exact: true })).toBeVisible()
    await expect(desktop.page.getByText('Live Forever', { exact: true })).toBeVisible()
    await desktop.app.close(); desktop = await launchApp(data)
    await expect(desktop.page.getByText(raw, { exact: true })).toBeVisible()
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
})
