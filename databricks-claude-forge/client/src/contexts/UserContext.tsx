import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fetchUserInfo } from "@/lib/api";
import type { BrandingConfig, UserInfo } from "@/lib/types";

interface UserContextType {
  user: string | null;
  workspaceUrl: string | null;
  databaseAvailable: boolean;
  lakebaseConfigured: boolean;
  lakebaseError: string | null;
  branding: BrandingConfig;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

const defaultBranding: BrandingConfig = {
  app_title: 'Vibe Coding Workshop',
  partner_name: '',
  show_databricks_logo: true,
};

const UserContext = createContext<UserContextType | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadUser = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await fetchUserInfo();
      setUserInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const value: UserContextType = {
    user: userInfo?.user || null,
    workspaceUrl: userInfo?.workspace_url || null,
    databaseAvailable: userInfo?.database_available || false,
    lakebaseConfigured: userInfo?.lakebase_configured || false,
    lakebaseError: userInfo?.lakebase_error || null,
    branding: userInfo?.branding || defaultBranding,
    loading,
    error,
    retry: loadUser,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
