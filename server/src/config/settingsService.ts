import type { AppSettings, SettingsSection } from '../../../shared/types.ts';
import type { Repository } from '../db/repository.ts';
import type { EventBus } from '../core/eventBus.ts';
import { UserError } from '../core/util.ts';
import { DEFAULT_SETTINGS, SECTION_SCHEMAS, formatZodError } from './schema.ts';

const SECTIONS = Object.keys(DEFAULT_SETTINGS) as SettingsSection[];

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return (patch ?? base) as T;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/**
 * Ustawienia aplikacji: wartości domyślne + zapis w bazie, walidacja zod.
 * Silnik odczytuje je przy każdym cyklu, więc zmiany z panelu działają od razu.
 */
export class SettingsService {
  private current: AppSettings;
  private repo: Repository;
  private bus: EventBus;
  private warn: (msg: string) => void;

  constructor(repo: Repository, bus: EventBus, warn: (msg: string) => void) {
    this.repo = repo;
    this.bus = bus;
    this.warn = warn;
    this.current = this.load();
  }

  private load(): AppSettings {
    const stored = this.repo.getSettingsRaw();
    const result = structuredClone(DEFAULT_SETTINGS) as unknown as Record<SettingsSection, unknown>;
    for (const section of SECTIONS) {
      const merged = deepMerge(structuredClone(DEFAULT_SETTINGS[section]), stored[section]);
      const parsed = SECTION_SCHEMAS[section].safeParse(merged);
      if (parsed.success) result[section] = parsed.data;
      else this.warn(`Nieprawidłowe ustawienia „${section}” w bazie — użyto domyślnych (${formatZodError(parsed.error)})`);
    }
    return result as unknown as AppSettings;
  }

  get(): AppSettings {
    return this.current;
  }

  update<K extends SettingsSection>(section: K, patch: unknown): AppSettings[K] {
    if (!SECTIONS.includes(section)) throw new UserError(`Nieznana sekcja ustawień: ${section}`);
    const merged = deepMerge(structuredClone(this.current[section]), patch);
    const parsed = SECTION_SCHEMAS[section].safeParse(merged);
    if (!parsed.success) throw new UserError(formatZodError(parsed.error));
    this.current = { ...this.current, [section]: parsed.data };
    this.repo.saveSettings(section, parsed.data);
    this.bus.emit('settings.updated', this.current);
    return parsed.data as AppSettings[K];
  }

  /** Walidacja bez zapisu (np. przy zapisie presetu). */
  validate<K extends SettingsSection>(section: K, data: unknown): AppSettings[K] {
    const merged = deepMerge(structuredClone(DEFAULT_SETTINGS[section]), data);
    const parsed = SECTION_SCHEMAS[section].safeParse(merged);
    if (!parsed.success) throw new UserError(formatZodError(parsed.error));
    return parsed.data as AppSettings[K];
  }
}
