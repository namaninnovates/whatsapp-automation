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

export const DEMO_CREDENTIALS = { email: 'owner@brightlane.test', password: 'Demo@12345' };

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
      <div className="w-full max-w-[380px] rounded-lg border border-line bg-surface p-6 shadow-sm">
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

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const s = await api.post<Session>('/auth/login', values);
      qc.setQueryData(['me'], s);
      navigate(params.get('next') || '/app', { replace: true });
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401 ? 'Email or password is incorrect.' : errorMessage(e),
      );
    }
  });

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Manage automations, conversations and customers."
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
      <div className="mt-4 rounded-md border border-line bg-subtle px-3 py-2.5 text-[12.5px] text-ink-2">
        <p className="font-medium text-ink">Demo workspace</p>
        <p className="mt-0.5">Seeded sample data for a fictional store.</p>
        <button
          type="button"
          className="mt-1.5 font-medium text-accent-ink underline-offset-2 hover:underline"
          onClick={() => {
            form.setValue('email', DEMO_CREDENTIALS.email);
            form.setValue('password', DEMO_CREDENTIALS.password);
          }}
        >
          Fill in demo credentials
        </button>
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
