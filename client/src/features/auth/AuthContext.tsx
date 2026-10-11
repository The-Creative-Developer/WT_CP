import type { AuthResponse, LoginInput, RegisterInput, SelfUser } from '@devverse/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, onSessionChange, refreshSession, setSession } from '../../lib/api';

export type AuthState =
  { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; user: SelfUser };

interface AuthContextValue {
  state: AuthState;
  login(input: LoginInput): Promise<SelfUser>;
  register(input: RegisterInput): Promise<SelfUser>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// [CONCEPT: BroadcastChannel] Logging in or out in one tab updates every other open tab of the app.
const CHANNEL_NAME = 'devverse-auth';
type AuthBroadcast = 'login' | 'logout';

const toState = (session: AuthResponse | null): AuthState =>
  session ? { status: 'authenticated', user: session.user } : { status: 'anonymous' };

// [CONCEPT: React Context] Any component can read the session without passing props through every level.
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // One channel for sending and receiving: a channel never hears its own messages, so this tab won't react to itself.
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const unsubscribe = onSessionChange((session) => {
      setState(toState(session));
      // Never show one user's cached data to the next person on this browser.
      if (!session) queryClient.clear();
    });
    // Restore the session after a page load: the access token was in memory, but the cookie survived.
    refreshSession().catch(() => setSession(null));
    return unsubscribe;
  }, [queryClient]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<AuthBroadcast>) => {
      if (event.data === 'logout') setSession(null);
      // Each tab needs its own access token; the shared cookie lets it get one.
      if (event.data === 'login') refreshSession().catch(() => setSession(null));
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const broadcast = (message: AuthBroadcast) => channelRef.current?.postMessage(message);

    const startSession = async (path: string, input: LoginInput | RegisterInput) => {
      const session = await api<AuthResponse>(path, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setSession(session);
      broadcast('login');
      return session.user;
    };

    return {
      state,
      login: (input) => startSession('/api/v1/auth/login', input),
      register: (input) => startSession('/api/v1/auth/register', input),
      async logout() {
        try {
          await api('/api/v1/auth/logout', { method: 'POST' });
        } finally {
          // Even if the request fails, forget the session locally.
          setSession(null);
          broadcast('logout');
        }
      },
    };
  }, [state]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
