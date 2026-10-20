import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  BookOpen,
  Bot,
  ExternalLink,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListTree,
  LogOut,
  MessageSquareDashed,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../lib/api';
import { cn, initials } from '../../lib/utils';
import { Logo } from '../Logo';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  badge?: boolean;
  highlight?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/app/inbox', label: 'Inbox', icon: Inbox, badge: true },
      { to: '/app/customers', label: 'Customers & Leads', icon: Users },
      { to: '/app/simulator', label: 'WhatsApp Simulator', icon: Smartphone, highlight: true },
    ],
  },
  {
    title: 'Automation Studio',
    items: [
      { to: '/app/automations', label: 'Workflows', icon: GitBranch },
      { to: '/app/menus', label: 'Interactive Menus', icon: ListTree },
      { to: '/app/assistant', label: 'AI Assistant', icon: Bot },
      { to: '/app/knowledge', label: 'Knowledge Base', icon: BookOpen },
    ],
  },
  {
    title: 'Management',
    items: [
      { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
];

interface Integrations {
  whatsapp: { status: string; mode: string };
  ai: { effectiveProvider: string };
}

export function AppShell() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const needsHuman = useQuery({
    queryKey: ['conversations', 'needs-human-count'],
    queryFn: () => api.get<{ total: number }>('/conversations?status=NEEDS_HUMAN&pageSize=1'),
    refetchInterval: 15000,
  });
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get<Integrations>('/settings/integrations'),
    staleTime: 60_000,
  });
  const live =
    integrations.data?.whatsapp.status === 'connected' ||
    integrations.data?.whatsapp.status === 'configured_unverified';

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Sidebar */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-line bg-surface shadow-xs">
        {/* Brand header */}
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <Logo />
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-800 ring-1 ring-emerald-600/20">
            v0.1
          </span>
        </div>

        {/* Grouped Navigation */}
        <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="px-2 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) =>
                      cn(
                        'group flex h-8.5 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-all select-none',
                        isActive
                          ? 'bg-emerald-50 font-semibold text-emerald-950 shadow-xs ring-1 ring-emerald-600/15'
                          : n.highlight
                            ? 'text-emerald-700 hover:bg-emerald-50/60 hover:text-emerald-800'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <n.icon
                          className={cn(
                            'size-4 shrink-0 transition-colors',
                            isActive
                              ? 'text-emerald-700'
                              : n.highlight
                                ? 'text-emerald-600'
                                : 'text-slate-400 group-hover:text-slate-600',
                          )}
                          strokeWidth={isActive ? 2.2 : 1.75}
                        />
                        <span className="flex-1 truncate">{n.label}</span>
                        {n.badge && !!needsHuman.data?.total && (
                          <span
                            title="Conversations needing human review"
                            className="rounded-full bg-amber-100 px-1.5 py-0.2 text-[10.5px] font-bold text-amber-900 tabular ring-1 ring-amber-600/20"
                          >
                            {needsHuman.data.total}
                          </span>
                        )}
                        {n.highlight && !isActive && (
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Channel Status and Profile Footer */}
        <div className="border-t border-line bg-slate-50/50 p-3">
          <div className="mb-2.5 rounded-lg border border-line bg-white p-2 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', live ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse')} />
                {live ? 'WhatsApp Live' : 'Simulated Channel'}
              </span>
              <span className="text-[10px] uppercase font-semibold text-slate-400">
                AI: {integrations.data?.ai.effectiveProvider ?? 'mock'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[12px] font-bold text-emerald-900 shadow-xs">
              {initials(session?.user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-slate-800 leading-tight">
                {session?.organization.name}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {session?.user.name} · <span className="capitalize">{session?.role.toLowerCase()}</span>
              </p>
            </div>
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              onClick={async () => {
                await signOut();
                navigate('/login');
              }}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-800 transition-colors cursor-pointer"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Universal Top Header Bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-6 shadow-xs">
          <div className="flex items-center gap-3 text-[12.5px]">
            <span className="font-semibold text-slate-800">{session?.organization.name}</span>
            <span className="text-slate-300">/</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
              <ShieldCheck className="size-3 text-emerald-600" />
              Role: <span className="capitalize font-semibold text-slate-800">{session?.role.toLowerCase()}</span>
            </span>
            {session?.organization.isDemo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-600/20">
                Demo Workspace (Brightlane Home)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <NavLink
              to="/app/simulator"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-100 transition-all shadow-xs"
            >
              <Smartphone className="size-3.5" />
              Test in Simulator
            </NavLink>
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Docs
              <ExternalLink className="size-3 text-slate-400" />
            </a>
          </div>
        </header>

        {/* Viewport */}
        <main className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
