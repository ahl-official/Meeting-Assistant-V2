import { useMemo } from 'react';
import { useSession, signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react';

/**
 * useAuth — drop-in replacement for the old useAuth hook.
 *
 * Returns the same shape the rest of the app expects:
 *   { user, loading, signIn, signOut }
 *
 * `user` shape: { id, email, phone, username, isAdmin }
 * This matches what the jwt/session callbacks in [...nextauth].js provide.
 */
export function useAuth() {
  const { data: session, status } = useSession();

  const user = useMemo(() => {
    if (!session?.user) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      phone: session.user.phone || '',
      username: session.user.username || session.user.name,
      isAdmin: session.user.isAdmin || false,
    };
  }, [session]);

  return {
    user,
    loading: status === 'loading',
    signIn: nextAuthSignIn,
    signOut: () => nextAuthSignOut({ callbackUrl: '/' }),
  };
}
