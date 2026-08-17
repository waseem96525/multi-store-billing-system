import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { login } from '../api/auth';
import { setCredentials } from '../store/slices/authSlice';
import { setCurrentStore } from '../store/slices/storeSlice';

export default function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const token = useSelector((s) => s.auth.token);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (token) navigate('/', { replace: true });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(username, password);
      dispatch(setCredentials(data));
      if (data.user?.store_id) {
        dispatch(setCurrentStore(data.user.store_id));
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animated-bg min-h-screen flex items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-lg shadow-2xl w-[min(92vw,20rem)] space-y-4 animate-slide-in"
      >
        <h1 className="text-xl font-bold text-center text-slate-800">Retail POS Login</h1>
        {error && <div className="text-red-600 text-sm text-center">{error}</div>}
        <div>
          <label className="block text-sm text-slate-600">Email or Username</label>
          <input
            className="w-full border rounded px-2 py-1"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm text-slate-600">Password</label>
          <input
            type="password"
            className="w-full border rounded px-2 py-1"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-800 text-white py-2 rounded hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <p className="text-xs text-center text-slate-400">
          First run admin: admin@billingsol-e9a83.firebaseapp.com / admin123
        </p>
      </form>
    </div>
  );
}
