import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';
import { errorMessage } from '../types';
import { Button, TextField } from '../components/ui';

export default function Login() {
  const { loginWithCode } = useEmployee();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/entry';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await loginWithCode(code);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>Enter your Employee ID</h1>
        <p className="muted">Only accessible employee can enter this page.</p>
        <TextField autoFocus className="login-input" placeholder="000001" inputMode="numeric" ariaLabel="Employee ID" value={code} onChange={setCode} />
        {error && <div className="alert alert-error">{error}</div>}
        <Button themeColor="primary" size="large" type="submit" disabled={submitting}>
          {submitting ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    </div>
  );
}
