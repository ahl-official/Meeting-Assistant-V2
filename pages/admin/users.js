import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../lib/auth';
import { getAllUsers, setAdmin, setActive, resetPassword } from '../../lib/api';
import AdminLayout from '../../components/AdminLayout';
import styles from '../../styles/Admin.module.css';

function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pass = '';
    for (let i = 0; i < 12; i++) {
        pass += chars[Math.floor(Math.random() * chars.length)];
    }
    return pass;
}

function useAdminGuard() {
    const { user, loading } = useAuth();
    const router = useRouter();
    useEffect(() => {
        if (!loading && (!user || !user.isAdmin)) router.replace('/admin/login');
    }, [user, loading]);
    return { user, loading, ready: !loading && !!user?.isAdmin };
}

export default function AdminUsers() {
    const { user, ready } = useAdminGuard();
    const [users, setUsers] = useState([]);
    const [fetching, setFetching] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [busy, setBusy] = useState({});

    const [resetTarget, setResetTarget] = useState(null);
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [customPassword, setCustomPassword] = useState('');
    const [copied, setCopied] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [resetSuccess, setResetSuccess] = useState(false);
    const [resetError, setResetError] = useState('');

    useEffect(() => {
        if (!ready) return;
        loadUsers();
    }, [ready]);

    const loadUsers = async () => {
        setFetching(true);
        try {
            const data = await getAllUsers(user.username);
            setUsers(data.users || []);
        } catch (err) {
            alert('Failed to load users: ' + err.message);
        } finally {
            setFetching(false);
        }
    };

    const handleToggleActive = async (target) => {
        const newVal = !target.active;
        if (!confirm(`${newVal ? 'Activate' : 'Deactivate'} account for ${target.username}?`)) return;
        setBusy(b => ({ ...b, [target.username + '_active']: true }));
        try {
            await setActive(user.username, target.username, newVal);
            setUsers(prev => prev.map(u =>
                u.username === target.username ? { ...u, active: newVal } : u
            ));
        } catch (err) {
            alert('Failed: ' + err.message);
        } finally {
            setBusy(b => ({ ...b, [target.username + '_active']: false }));
        }
    };

    const handleToggleAdmin = async (target) => {
        const newVal = !target.isAdmin;
        if (!confirm(`${newVal ? 'Grant' : 'Revoke'} admin access for ${target.username}?`)) return;
        setBusy(b => ({ ...b, [target.username + '_admin']: true }));
        try {
            await setAdmin(user.username, target.username, newVal);
            setUsers(prev => prev.map(u =>
                u.username === target.username ? { ...u, isAdmin: newVal } : u
            ));
        } catch (err) {
            alert('Failed: ' + err.message);
        } finally {
            setBusy(b => ({ ...b, [target.username + '_admin']: false }));
        }
    };

    const openResetModal = (target) => {
        setResetTarget(target);
        setGeneratedPassword(generateTempPassword());
        setCustomPassword('');
        setCopied(false);
        setResetting(false);
        setResetSuccess(false);
        setResetError('');
    };

    const closeResetModal = () => {
        setResetTarget(null);
        setGeneratedPassword('');
        setCustomPassword('');
        setCopied(false);
        setResetting(false);
        setResetSuccess(false);
        setResetError('');
    };

    const passwordToUse = () => (customPassword.trim() || generatedPassword);

    const handleCopyPassword = async () => {
        try {
            await navigator.clipboard.writeText(passwordToUse());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setResetError('Could not copy to clipboard');
        }
    };

    const handleRegenerate = () => {
        if (resetSuccess) return;
        setGeneratedPassword(generateTempPassword());
        setCustomPassword('');
        setCopied(false);
        setResetError('');
    };

    const handleResetPassword = async () => {
        if (!resetTarget || resetSuccess) return;
        const nextPassword = passwordToUse();
        if (!nextPassword || nextPassword.length < 8) {
            setResetError('Password must be at least 8 characters');
            return;
        }
        setResetting(true);
        setResetError('');
        try {
            await resetPassword(resetTarget.username, nextPassword);
            setGeneratedPassword(nextPassword);
            setCustomPassword('');
            setResetSuccess(true);
        } catch (err) {
            setResetError(err.message || 'Password reset failed');
        } finally {
            setResetting(false);
        }
    };

    const filtered = users.filter(u => {
        const q = search.toLowerCase();
        const matchSearch = !q ||
            u.username?.toLowerCase().includes(q) ||
            u.email?.toLowerCase().includes(q) ||
            u.phone?.toLowerCase().includes(q);
        const matchFilter =
            filter === 'all' ? true :
                filter === 'active' ? u.active :
                    filter === 'inactive' ? !u.active :
                        filter === 'admin' ? u.isAdmin : true;
        return matchSearch && matchFilter;
    });

    if (!ready) return null;

    return (
        <AdminLayout active="credentials">
            <div className={styles.page}>
                <main className={styles.main}>
                    <div className={styles.header}>
                        <div className={styles.headerLeft}>
                            <h1 className={styles.title}>User Credentials</h1>
                            <p className={styles.subtitle}>{users.length} registered accounts</p>
                        </div>
                        <div className={styles.headerActions}>
                            <button className="btn btn-secondary" onClick={loadUsers}>↻ Refresh</button>
                        </div>
                    </div>

                    <div className={styles.toolbar}>
                        <input
                            className={'input ' + styles.search}
                            placeholder="Search by name, email, phone…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        <select
                            className={styles.filterSelect}
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                        >
                            <option value="all">All users</option>
                            <option value="active">Active only</option>
                            <option value="inactive">Inactive only</option>
                            <option value="admin">Admins only</option>
                        </select>
                    </div>

                    {fetching ? (
                        <div className={styles.loading}><span className="spinner" /> Loading users…</div>
                    ) : filtered.length === 0 ? (
                        <div className={styles.empty}>
                            <div className={styles.emptyIcon}>👤</div>
                            <h3>No users found</h3>
                            <p>{search ? 'Try a different search term.' : 'No users have registered yet.'}</p>
                        </div>
                    ) : (
                        <div className={styles.tableWrap}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Username</th>
                                        <th>Email</th>
                                        <th>Phone</th>
                                        <th>Joined</th>
                                        <th>Status</th>
                                        <th>Role</th>
                                        <th style={{ textAlign: 'right' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((u) => {
                                        const isSelf = u.username === user.username;
                                        return (
                                        <tr key={u.id || u.username}>
                                            <td><span className={styles.usernameCell}>{u.username}</span></td>
                                            <td><span className={styles.emailCell}>{u.email || '—'}</span></td>
                                            <td><span className={styles.emailCell}>{u.phone || '—'}</span></td>
                                            <td>
                                                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                                                    {u.createdAt
                                                        ? new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                                                        : '—'}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={'badge ' + (u.active ? 'badge-green' : 'badge-gray')}>
                                                    {u.active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td>
                                                {u.isAdmin && <span className="badge badge-blue">Admin</span>}
                                            </td>
                                            <td>
                                                <div className={styles.tdActions}>
                                                    <button
                                                        className={'btn btn-primary ' + styles.btnSm}
                                                        onClick={() => openResetModal(u)}
                                                        disabled={isSelf}
                                                        title={isSelf ? 'You cannot reset your own password' : 'Reset password'}
                                                    >
                                                        Reset Password
                                                    </button>
                                                    <button
                                                        className={'btn btn-danger ' + styles.btnSm}
                                                        onClick={() => handleToggleActive(u)}
                                                        disabled={busy[u.username + '_active']}
                                                    >
                                                        {busy[u.username + '_active'] ? '…' : (u.active ? 'Deactivate' : 'Activate')}
                                                    </button>
                                                    {!isSelf && (
                                                        <button
                                                            className={'btn ' + styles.btnSm + ' ' + styles.btnGray}
                                                            onClick={() => handleToggleAdmin(u)}
                                                            disabled={busy[u.username + '_admin']}
                                                        >
                                                            {busy[u.username + '_admin'] ? '…' : (u.isAdmin ? 'Revoke Admin' : 'Make Admin')}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </main>
            </div>

            {resetTarget && (
                <div className={styles.overlay}>
                    <div className={styles.modal + ' ' + styles.modalWide} role="dialog" aria-modal="true">
                        <h2 className={styles.modalTitle}>Reset Password for {resetTarget.username}</h2>
                        <p className={styles.modalSub}>
                            Share the new password with this user, then close this dialog. It cannot be retrieved later.
                        </p>

                        <div className={styles.modalUserInfo}>
                            <div className={styles.modalUserRow}>
                                <span className={styles.modalUserLabel}>Email</span>
                                <span className={styles.modalUserValue}>{resetTarget.email || '—'}</span>
                            </div>
                            <div className={styles.modalUserRow}>
                                <span className={styles.modalUserLabel}>Phone</span>
                                <span className={styles.modalUserValue}>{resetTarget.phone || '—'}</span>
                            </div>
                        </div>

                        {resetSuccess && (
                            <div className={styles.successBanner}>
                                Password reset successfully. Share the new password with the user.
                            </div>
                        )}

                        {resetError && (
                            <div className={styles.errorBox}>{resetError}</div>
                        )}

                        <label className={styles.label}>Temporary password</label>
                        <input
                            className={styles.passwordDisplay}
                            value={passwordToUse()}
                            readOnly
                        />
                        <div className={styles.passwordActions}>
                            <button type="button" className="btn btn-sm btn-secondary" onClick={handleCopyPassword}>
                                {copied ? 'Copied' : 'Copy Password'}
                            </button>
                            {!resetSuccess && (
                                <button type="button" className="btn btn-sm btn-ghost" onClick={handleRegenerate}>
                                    Regenerate
                                </button>
                            )}
                        </div>

                        {!resetSuccess && (
                            <>
                                <label className={styles.label}>Custom password (optional)</label>
                                <input
                                    className={'input ' + styles.customPasswordInput}
                                    type="text"
                                    autoComplete="off"
                                    placeholder="Leave blank to use the generated password"
                                    value={customPassword}
                                    onChange={e => {
                                        setCustomPassword(e.target.value);
                                        setCopied(false);
                                    }}
                                />
                            </>
                        )}

                        <div className={styles.modalActions}>
                            {resetSuccess ? (
                                <button type="button" className="btn btn-primary" onClick={closeResetModal}>
                                    Done
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={handleResetPassword}
                                        disabled={resetting}
                                    >
                                        {resetting ? 'Resetting…' : 'Reset Password'}
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={closeResetModal} disabled={resetting}>
                                        Cancel
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}
