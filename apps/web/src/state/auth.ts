import { create } from 'zustand';

/** Session state; filled by the Supabase auth module (phase 5). */
export interface AuthState {
  userId: string | null;
  email: string | null;
  proxyToken: string | null;
  proxyTokenExp: number;
}

export const useAuth = create<AuthState>()(() => ({ userId: null, email: null, proxyToken: null, proxyTokenExp: 0 }));
