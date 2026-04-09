import { getTranslations, getLocale, setLocale } from './commands'
import { getContext, setContext } from 'svelte'

type Translations = Record<string, string>

const I18N_KEY = Symbol('i18n')

class I18n {
  translations = $state<Translations>({})
  locale = $state('en')

  constructor() {
    this.translations = {}
    this.locale = 'en'
  }

  async init() {
    try {
      const info = await getLocale()
      this.locale = info.current ?? 'en'
      if (info.translations) {
        this.translations = info.translations
      }
    } catch {
      // fallback: keep defaults
    }
  }

  async changeLocale(lang: string) {
    await setLocale(lang)
    this.locale = lang
    try {
      const t = await getTranslations(lang)
      this.translations = t ?? {}
    } catch {
      // keep existing translations
    }
  }

  t(key: string): string {
    return this.translations[key] ?? key
  }
}

export function createI18n(): I18n {
  const i18n = new I18n()
  setContext(I18N_KEY, i18n)
  return i18n
}

export function useI18n(): I18n {
  return getContext<I18n>(I18N_KEY)
}
