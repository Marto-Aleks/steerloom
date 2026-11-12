import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

interface ThemeController {
  setTheme: (theme: Theme) => void
  theme: Theme
  toggleTheme: () => void
  usesSystemTheme: boolean
}

const THEME_COLOR_PROPERTIES = ['--canvas', '--color-canvas'] as const

function updateThemeColor(theme: Theme) {
  const root = document.documentElement
  const computedStyles = window.getComputedStyle(root)
  const tokenColor = THEME_COLOR_PROPERTIES.map((property) =>
    computedStyles.getPropertyValue(property).trim(),
  ).find(Boolean)
  const fallbackColor = theme === 'dark' ? '#0c1019' : '#f2f2f7'
  const themeColor = tokenColor || fallbackColor
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]:not([media])',
  )

  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.append(meta)
  }
  meta.content = themeColor
}

export function useTheme(): ThemeController {
  const [theme, setPreference] = useState<Theme>('light')

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    updateThemeColor(theme)
  }, [theme])

  const setTheme = useCallback((nextTheme: Theme) => {
    setPreference(nextTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }, [setTheme, theme])

  return {
    setTheme,
    theme,
    toggleTheme,
    usesSystemTheme: false,
  }
}
