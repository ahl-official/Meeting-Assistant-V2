import { useAuth } from '../lib/auth';
import { useRouter } from 'next/router';
import styles from '../styles/Navbar.module.css';

export default function Navbar({ variant }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const isAdmin = variant === 'admin';

  const handleSignOut = () => {
    signOut();
    router.push(isAdmin ? '/admin/login' : '/');
  };

  return (
    <nav className={styles.nav + (isAdmin ? ' ' + styles.navAdmin : '')}>
      <div className={styles.left}>
        <span className={styles.icon}>◈</span>
        <span className={'app-name ' + styles.name}>AI Meeting Assistant</span>
        {isAdmin && <span className={styles.adminBadge}>Admin</span>}
      </div>
      <div className={styles.right}>
        {isAdmin && (
          <button className={'btn btn-ghost ' + styles.backLink} onClick={() => router.push('/dashboard')}>
            ← Back to App
          </button>
        )}
        {user && (
          <>
            <span className={styles.user}>
              <span className={styles.avatar}>{user.username?.[0]?.toUpperCase() || 'U'}</span>
              <span className={styles.userName}>{user.username}</span>
            </span>
            <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: 13 }}>
              Sign Out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
