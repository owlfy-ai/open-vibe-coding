import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  resolveTheme,
  subscribeToSystemTheme,
  systemPrefersDark,
  type ResolvedTheme,
} from "./theme";
import { useApplication } from "../runtime";

const ResolvedThemeContext = createContext<ResolvedTheme>("light");

/**
 * Applies the user's theme preference to the document root and exposes the
 * resolved (concrete light/dark) theme so descendants (e.g. the code preview)
 * can match it. Listens to the OS theme while the preference is "system".
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const { database } = useApplication();
  const preference = database.settings.system.theme;
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  useEffect(() => {
    const next = resolveTheme(preference);
    setResolved(next);
    applyTheme(next);
  }, [preference]);

  useEffect(() => {
    if (preference !== "system") return;
    const update = () => {
      const next: ResolvedTheme = systemPrefersDark() ? "dark" : "light";
      setResolved(next);
      applyTheme(next);
    };
    return subscribeToSystemTheme(update);
  }, [preference]);

  const value = useMemo(() => resolved, [resolved]);
  return <ResolvedThemeContext.Provider value={value}>{children}</ResolvedThemeContext.Provider>;
}

export function useResolvedTheme(): ResolvedTheme {
  return useContext(ResolvedThemeContext);
}
