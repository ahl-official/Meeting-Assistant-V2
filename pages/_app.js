import { useEffect } from 'react';
import Cookies from 'js-cookie';
import '../styles/globals.css';
import { SessionProvider } from 'next-auth/react';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    // Clean up legacy auth cookie from pre-NextAuth system
    if (Cookies.get('ama_user')) {
      Cookies.remove('ama_user');
    }
  }, []);

  return (
    <SessionProvider session={pageProps.session}>
      <Component {...pageProps} />
    </SessionProvider>
  );
}
