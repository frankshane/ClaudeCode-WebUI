import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const KEY = 'ccwebui.theme';

/** The boot script in index.html already applied the saved theme; read it back from <html>. */
export const useTheme = create<{ theme: Theme }>(() => ({
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
}));

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  localStorage.setItem(KEY, theme);
  useTheme.setState({ theme });
}
