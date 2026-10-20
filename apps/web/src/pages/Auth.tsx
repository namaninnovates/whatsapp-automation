import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LoginSchema, SignupSchema, type LoginInput, type SignupInput } from '@wa/shared';
import { Logo } from '../components/Logo';
import { Button, Field, Input } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Session } from '../lib/types';

import { Sparkles } from 'lucide-react';
import { createDemoSession, DEMO_PASSWORD, DEMO_USERS } from '../lib/mockData';

export const DEMO_CREDENTIALS = { email: DEMO_USERS.owner.email, password: DEMO_PASSWORD };

function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <Link to="/" className="mb-8">
        <Logo />
      </Link>
      <div className="w-full max-w-[400px] rounded-xl border border-line bg-surface p-6 shadow-sm">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        <p className="mt-1 text-[13px] text-ink-3">{subtitle}</p>
        <div className="mt-5">{children}</div>
      </div>
      <div className="mt-4 text-[13px] text-ink-3">{footer}</div>
    </div>
  );
}

export function LoginPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const demo = params.get('demo') === '1';
  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: demo ? DEMO_CREDENTIALS : { email: '', password: '' },
  });
  if (session) return <Navigate to={params.get('next') || '/app'} replace />;

  const loginAsDemo = async (role: 'owner' | 'agent' | 'viewer' = 'owner') => {
    setError(null);
    const user = DEMO_USERS[role];
    try {
      const s = await api.post<Session>('/auth/login', {
        email: user.email,
        password: DEMO_PASSWORD,
      });
      localStorage.setItem('wa_demo_session', JSON.stringify(s));
      qc.setQueryData(['me'], s);
      navigate(params.get('next') || '/app', { replace: true });
    } catch {
      const s = createDemoSession(role);
      localStorage.setItem('wa_demo_session', JSON.stringify(s));
      qc.setQueryData(['me'], s);
      navigate(params.get('next') || '/app', { replace: true });
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const s = await api.post<Session>('/auth/login', values);
      qc.setQueryData(['me'], s);
      navigate(params.get('next') || '/app', { replace: true });
    } catch (e) {
      if (values.email.endsWith('@brightlane.test')) {
        let role: 'owner' | 'agent' | 'viewer' = 'owner';
        if (values.email.includes('agent')) role = 'agent';
        else if (values.email.includes('viewer')) role = 'viewer';
        loginAsDemo(role);
        return;
      }
      setError(
        e instanceof ApiError && e.status === 401 ? 'Email or password is incorrect.' : errorMessage(e),
      );
    }
  });

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Manage automations, conversations and loyalty members."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-medium text-ink underline-offset-2 hover:underline">
            Create a workspace
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-3.5">
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!form.formState.errors.email}
            {...form.register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register('password')}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>

      {/* ── 1-Click Demo Login & Dummy Data ── */}
      <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-50/50 p-3.5 text-[12.5px]">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold text-emerald-800">
            <Sparkles className="size-3.5 text-emerald-600" /> Demo Credentials
          </span>
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
            Pre-seeded
          </span>
        </div>
        <p className="mt-1 text-slate-600">
          Click any role to log in with full pre-seeded loyalty points, chats and metrics:
        </p>

        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {(['owner', 'agent', 'viewer'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => loginAsDemo(r)}
              className="flex flex-col items-center rounded-lg border border-line bg-surface p-2 text-center transition hover:border-emerald-500 hover:shadow-xs active:scale-95"
            >
              <span className="text-[12px] font-bold text-ink capitalize">{r}</span>
              <span className="text-[10.5px] text-ink-3 truncate w-full">{DEMO_USERS[r].name}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-emerald-200/60 pt-2 text-[11.5px] text-slate-500">
          <span>
            Password:{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono font-medium text-ink border border-line">
              {DEMO_PASSWORD}
            </code>
          </span>
          <button
            type="button"
            onClick={() => {
              form.setValue('email', DEMO_USERS.owner.email);
              form.setValue('password', DEMO_PASSWORD);
            }}
            className="font-medium text-emerald-700 hover:underline"
          >
            Auto-fill form
          </button>
        </div>
      </div>
    </AuthFrame>
  );
}

export function SignupPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SignupInput>({
    resolver: zodResolver(SignupSchema),
    defaultValues: { name: '', email: '', password: '', businessName: '' },
  });
  if (session) return <Navigate to="/app" replace />;
  const e = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const s = await api.post<Session>('/auth/signup', values);
      qc.setQueryData(['me'], s);
      navigate('/app/menus', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthFrame
      title="Create your workspace"
      subtitle="Start with the simulated WhatsApp channel; connect the Cloud API when you are ready."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-ink underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-3.5">
        <Field label="Your name" htmlFor="name" error={e.name?.message}>
          <Input id="name" autoComplete="name" aria-invalid={!!e.name} {...form.register('name')} />
        </Field>
        <Field label="Business name" htmlFor="businessName" error={e.businessName?.message}>
          <Input id="businessName" aria-invalid={!!e.businessName} {...form.register('businessName')} />
        </Field>
        <Field label="Work email" htmlFor="email" error={e.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!e.email}
            {...form.register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={e.password?.message} hint="At least 8 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!e.password}
            {...form.register('password')}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Create workspace
        </Button>
      </form>
    </AuthFrame>
  );
}
