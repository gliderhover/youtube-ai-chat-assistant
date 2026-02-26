import { useState } from 'react';
import { createUser, findUser } from '../services/mongoApi';
import './Auth.css';

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const name = username.trim().toLowerCase();
      if (mode === 'create') {
        const safeFirst = firstName.trim();
        const safeLast = lastName.trim();
        if (!safeFirst || !safeLast) {
          setError('First name and last name are required');
          setLoading(false);
          return;
        }
        await createUser(name, password, email.trim(), safeFirst, safeLast);
        setError('');
        setMode('login');
        setPassword('');
        setEmail('');
        setFirstName('');
        setLastName('');
      } else {
        const user = await findUser(name, password);
        if (!user) throw new Error('User not found or invalid password');
        onLogin(user);
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('Proxy error') || msg.includes('ECONNREFUSED') || msg.includes('Failed to fetch')) {
        setError('Cannot reach the backend. Make sure the server is running on http://localhost:3001.');
      } else {
        try {
          const j = JSON.parse(msg);
          setError(j.error || msg);
        } catch {
          setError(msg || 'Something went wrong');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-header">
          <h1>Chat</h1>
          <p className="auth-subtitle">Yale · Modern</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
          {mode === 'create' && (
            <>
              <input
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                minLength={1}
                autoComplete="given-name"
              />
              <input
                type="text"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                minLength={1}
                autoComplete="family-name"
              />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </>
          )}
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
          />
          {error && (
        <p className="auth-error">
          {error}
          {error.includes('already exists') && ' Try logging in instead.'}
        </p>
      )}
          <button type="submit" disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode((m) => (m === 'login' ? 'create' : 'login'));
            setError('');
          }}
        >
          {mode === 'login' ? 'Create an account' : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
