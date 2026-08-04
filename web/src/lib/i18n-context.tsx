import { createContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { en, zhCN } from './locales'

export type Locale = 'en' | 'zh-CN'

export type Translations = Record<string, string>

export type I18nContextValue = {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const I18nContext = createContext<I18nContextValue | null>(null)

const locales: Record<Locale, Translations> = { en, 'zh-CN': zhCN }

/**
 * Replace `{key}` placeholders. When `n` is present and `s` is not, derive the
 * English plural suffix for locale strings like `{n} new message{s}`
 * (HappyThread NewMessagesIndicator — otherwise the UI shows literal `{s}`).
 */
export function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str
  const resolved: Record<string, string | number> = { ...params }
  if (resolved.s === undefined && resolved.n !== undefined) {
    const n = typeof resolved.n === 'number' ? resolved.n : Number(resolved.n)
    if (Number.isFinite(n)) {
      resolved.s = n === 1 ? '' : 's'
    }
  }
  return str.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = resolved[key]
    return value !== undefined ? String(value) : match
  })
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('hapi-lang')
    return (saved === 'en' || saved === 'zh-CN') ? saved : 'en'
  })

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    localStorage.setItem('hapi-lang', newLocale)
    document.documentElement.lang = newLocale
  }, [])

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const dict = locales[locale] ?? locales.en
    const value = dict[key]
    const fallback = locales.en[key] ?? key
    return interpolate(value ?? fallback, params)
  }, [locale])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <I18nContext.Provider value={{ t, locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}
