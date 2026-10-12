import { z } from 'zod'
export const AppModuleSchema = z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), route: z.string().regex(/^\/[a-z0-9/-]+$/), title: z.string().min(1).max(100), requiredCapabilities: z.array(z.string().min(1)).max(20) })
export type AppModule = z.infer<typeof AppModuleSchema>
export class AppModuleRegistry {
  private readonly modules = new Map<string, AppModule>()
  register(module: AppModule): void { const value = AppModuleSchema.parse(module); if (this.modules.has(value.id) || [...this.modules.values()].some(m => m.route === value.route)) throw new Error('模块或路由重复'); this.modules.set(value.id, structuredClone(value)) }
  list(availableCapabilities: string[]): AppModule[] { return structuredClone([...this.modules.values()].filter(module => module.requiredCapabilities.every(capability => availableCapabilities.includes(capability)))) }
  resolve(route: string, availableCapabilities: string[]): AppModule | null { return this.list(availableCapabilities).find(module => module.route === route) ?? null }
}
export function builtInModules(): AppModuleRegistry { const registry = new AppModuleRegistry(); for (const module of [
  { id: 'library', route: '/library', title: '音乐库', requiredCapabilities: ['local-library'] },
  { id: 'audio-editor', route: '/creative/audio', title: '音频创作', requiredCapabilities: ['local-audio-editor'] },
  { id: 'visual-editor', route: '/creative/visual', title: '视觉创作', requiredCapabilities: ['local-visual-editor'] },
  { id: 'settings', route: '/settings', title: '应用设置', requiredCapabilities: [] }
]) registry.register(module); return registry }
