import { create } from 'zustand';

/** Session state; filled by src/cloud/auth.ts when Supabase is configured. */
export interface AuthState {
  userId: string | null;
  email: string | null;
  proxyToken: string | null;
  proxyTokenExp: number;
  /** The Worker refused this account (not in ALLOWED_USERS). */
  proxyDenied?: boolean;
}

export const useAuth = create<AuthState>()(() => ({ userId: null, email: null, proxyToken: null, proxyTokenExp: 0 }));
