import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';
import { errorMessage, type Employee } from '../types';
import { Button, TextField, InfoTip } from '../components/ui';

type Step = 'code' | 'password' | 'no_password';

export default function Login() {
  const { loginWithCode } = useEmployee();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('code');
  const [admin, setAdmin] = useState<Employee | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/entry';

  function backToCode() {
    setStep('code');
    setAdmin(null);
    setPassword('');
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    if (step === 'password' && !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await loginWithCode(code, step === 'password' ? password : undefined);
      if (result.status === 'ok') {
        navigate(from, { replace: true });
      } else {
        setAdmin(result.employee);
        setStep(result.status === 'needs_password' ? 'password' : 'no_password');
      }
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'no_password') {
    return (
      <div className="center-page">
        <div className="card login-card">
          <h1>Password not set yet</h1>
          <p className="muted">
            {admin?.name} is a site admin, and site admins sign in with a password. Yours hasn't been set yet — ask another
            site admin to set it under Site Admin → Employees.
          </p>
          <Button type="button" fillMode="outline" onClick={backToCode}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="center-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        {step === 'code' ? (
          <>
            <h1>
              Enter your Employee ID <InfoTip>Only accessible employee can enter this page.</InfoTip>
            </h1>
            <TextField autoFocus className="login-input" placeholder="000001" inputMode="numeric" ariaLabel="Employee ID" value={code} onChange={setCode} />
          </>
        ) : (
          <>
            <h1>
              Site admin password <InfoTip>Site admins sign in with a password. Forgot it? Another site admin can reset it.</InfoTip>
            </h1>
            <p className="muted">{admin?.name}</p>
            <TextField
              autoFocus
              type="password"
              autoComplete="current-password"
              className="login-input"
              ariaLabel="Password"
              value={password}
              onChange={setPassword}
            />
          </>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <Button themeColor="primary" size="large" type="submit" disabled={submitting}>
          {submitting ? 'Checking…' : step === 'code' ? 'Continue' : 'Sign in'}
        </Button>
        {step === 'password' && (
          <Button type="button" fillMode="flat" onClick={backToCode} disabled={submitting}>
            Not you? Change Employee ID
          </Button>
        )}
      </form>
    </div>
  );
}
