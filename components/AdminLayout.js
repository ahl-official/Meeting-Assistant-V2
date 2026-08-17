import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';
import { getAllUsers } from '../lib/api';
import Navbar from './Navbar';
import styles from '../styles/AdminLayout.module.css';

const NAV_ITEMS = [
    { key: 'dashboard', label: 'Dashboard', icon: '▦' },
    { key: 'credentials', label: 'User Credentials', icon: '🔑' },
    { key: 'userdata', label: 'User Data', icon: '👤' },
    { key: 'meetings', label: 'All Meetings', icon: '📋' },
];

export default function AdminLayout({ children, active }) {
    const router = useRouter();
    const { user, signOut } = useAuth();

    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(false);

    const [credOpen, setCredOpen] = useState({});
    const [credCopied, setCredCopied] = useState({});
    const [selectedUser, setSelectedUser] = useState(null);
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    const needsUsers = active === 'credentials' || active === 'userdata' || active === 'userdata-browse';

    useEffect(() => {
        if (!user || !needsUsers) return;
        setLoadingUsers(true);
        getAllUsers(user.username)
            .then(d => setUsers(d.users || []))
            .catch(console.error)
            .finally(() => setLoadingUsers(false));
    }, [user, active]);

    useEffect(() => {
        setMobileOpen(false);
    }, [router.asPath]);

    const handleNav = (key) => {
        const routes = {
            dashboard: '/admin',
            credentials: '/admin/users',
            userdata: '/admin/meetings?view=userdata',
            meetings: '/admin/meetings',
        };
        router.push(routes[key] || '/admin');
        setMobileOpen(false);
    };

    const handleSignOut = () => {
        signOut();
        router.push('/admin/login');
    };

    const toggleCred = (u) => {
        setCredOpen(prev => ({ ...prev, [u.username]: !prev[u.username] }));
    };

    const copyCred = (username, text) => {
        navigator.clipboard.writeText(text);
        setCredCopied(prev => ({ ...prev, [username]: true }));
        setTimeout(() => setCredCopied(prev => ({ ...prev, [username]: false })), 2000);
    };

    const selectUser = (u) => {
        setSelectedUser(u);
        router.push(`/admin/meetings?user=${encodeURIComponent(u.username)}`, undefined, { shallow: true });
        setMobileOpen(false);
    };

    const sidebarClass = [
        styles.sidebar,
        collapsed ? styles.sidebarCollapsed : '',
        mobileOpen ? styles.sidebarOpen : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={styles.shell}>
            <Navbar variant="admin" />

            <div className={styles.mobileBar}>
                <button
                    className={styles.menuBtn}
                    onClick={() => {
                        setMobileOpen(o => !o);
                        setCollapsed(false);
                    }}
                    aria-label="Toggle menu"
                >
                    {mobileOpen ? '✕' : '☰'}
                </button>
                <span className={styles.brandText}>Admin</span>
            </div>

            <div className={styles.body}>
                {mobileOpen && <div className={styles.overlay} onClick={() => setMobileOpen(false)} />}

                <aside className={sidebarClass}>
                    <div className={styles.sidebarTop}>
                        {!collapsed && (
                            <div className={styles.brand}>
                                <span className={styles.brandText}>Navigation</span>
                            </div>
                        )}
                        <button
                            className={styles.collapseBtn}
                            onClick={() => setCollapsed(c => !c)}
                            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {collapsed ? '›' : '‹'}
                        </button>
                    </div>

                    <nav className={styles.nav}>
                        {NAV_ITEMS.map(item => {
                            const isActive = active === item.key;
                            return (
                                <div key={item.key}>
                                    <button
                                        className={styles.navBtn + (isActive ? ' ' + styles.navBtnActive : '')}
                                        style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                                        onClick={() => handleNav(item.key)}
                                        title={collapsed ? item.label : undefined}
                                    >
                                        <span className={styles.navIcon}>{item.icon}</span>
                                        {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
                                    </button>

                                    {!collapsed && active === 'credentials' && item.key === 'credentials' && (
                                        <div className={styles.subList}>
                                            {loadingUsers ? (
                                                <div className={styles.subLoading}>Loading…</div>
                                            ) : users.length === 0 ? (
                                                <div className={styles.subLoading}>No users</div>
                                            ) : users.map(u => (
                                                <div key={u.username} className={styles.credItem}>
                                                    <button className={styles.credRow} onClick={() => toggleCred(u)}>
                                                        <span className={styles.credAvatar}>
                                                            {u.username[0].toUpperCase()}
                                                        </span>
                                                        <span className={styles.credName}>{u.username}</span>
                                                        <span
                                                            className={styles.credChevron}
                                                            style={{ transform: credOpen[u.username] ? 'rotate(90deg)' : 'none' }}
                                                        >›</span>
                                                    </button>

                                                    {credOpen[u.username] && (
                                                        <div className={styles.credExpanded}>
                                                            <div className={styles.credField}>
                                                                <span className={styles.credFieldLabel}>Username</span>
                                                                <div className={styles.credFieldRow}>
                                                                    <span className={styles.credFieldValue}>{u.username}</span>
                                                                    <button className={styles.copyBtn} onClick={() => copyCred(u.username + '_u', u.username)}>
                                                                        {credCopied[u.username + '_u'] ? '✓' : '⧉'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className={styles.credField}>
                                                                <span className={styles.credFieldLabel}>Password</span>
                                                                <div className={styles.credFieldRow}>
                                                                    <span className={styles.credFieldValue}>
                                                                        Not available (hashed)
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {u.email && <div className={styles.credMeta}>{u.email}</div>}
                                                            {u.phone && <div className={styles.credMeta}>{u.phone}</div>}
                                                            <div className={styles.credMeta}>
                                                                <span
                                                                    className={styles.credStatus}
                                                                    style={{
                                                                        background: u.active ? '#D1FAE5' : 'var(--gray-100)',
                                                                        color: u.active ? '#065F46' : 'var(--gray-600)',
                                                                    }}
                                                                >
                                                                    {u.active ? 'Active' : 'Inactive'}
                                                                </span>
                                                                {u.isAdmin && (
                                                                    <span className={styles.credAdminBadge}>Admin</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {!collapsed && active === 'userdata' && item.key === 'userdata' && (
                                        <div className={styles.subList}>
                                            {loadingUsers ? (
                                                <div className={styles.subLoading}>Loading…</div>
                                            ) : users.length === 0 ? (
                                                <div className={styles.subLoading}>No users</div>
                                            ) : users.map(u => (
                                                <button
                                                    key={u.username}
                                                    className={styles.userDataRow + (selectedUser?.username === u.username ? ' ' + styles.userDataRowActive : '')}
                                                    onClick={() => selectUser(u)}
                                                >
                                                    <span className={styles.credAvatar}>
                                                        {u.username[0].toUpperCase()}
                                                    </span>
                                                    <div className={styles.userDataInfo}>
                                                        <span className={styles.userDataName}>{u.username}</span>
                                                        <span className={styles.userDataSub}>{u.email || u.phone || '—'}</span>
                                                    </div>
                                                    <span style={{
                                                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                                                        background: u.active ? 'var(--success)' : 'var(--gray-400)',
                                                    }} />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </nav>

                    {!collapsed && (
                        <div className={styles.sidebarBottom}>
                            <div className={styles.adminUser}>
                                <div className={styles.adminAvatar}>
                                    {user?.username?.[0]?.toUpperCase() || 'A'}
                                </div>
                                <div className={styles.adminInfo}>
                                    <span className={styles.adminName}>{user?.username}</span>
                                    <span className={styles.adminRole}>Administrator</span>
                                </div>
                            </div>
                            <button className={styles.signOutBtn} onClick={handleSignOut}>
                                Sign Out
                            </button>
                        </div>
                    )}
                    {collapsed && (
                        <button className={styles.signOutBtn} onClick={handleSignOut} title="Sign out">
                            ↩
                        </button>
                    )}
                </aside>

                <main className={styles.content}>
                    {children}
                </main>
            </div>
        </div>
    );
}
