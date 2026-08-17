import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { findUser } from '../../../lib/db';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        identifier: { label: 'Email, Phone, or Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) {
          return null;
        }

        const user = await findUser(credentials.identifier);
        if (!user) return null;

        if (!user.is_active) {
          throw new Error('Account is deactivated');
        }

        const ok = await bcrypt.compare(credentials.password, user.password_hash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.username,
          username: user.username,
          phone: user.phone || '',
          isAdmin: user.is_admin,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // `user` is only passed on initial sign-in (from authorize return)
      // After that, `token` carries the data
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.phone = user.phone;
        token.isAdmin = user.isAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      // Make custom fields available via useSession() on the client
      session.user.id = token.id;
      session.user.username = token.username;
      session.user.phone = token.phone;
      session.user.isAdmin = token.isAdmin;
      return session;
    },
  },

  session: {
    strategy: 'jwt', // MUST be jwt for Credentials provider
    maxAge: 7 * 24 * 60 * 60, // 7 days, matches current cookie expiry
  },

  pages: {
    signIn: '/', // your login page is the index page
    error: '/', // redirect auth errors to login page
  },

  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
