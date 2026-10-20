import {
  createDemoSession,
  MOCK_ACTIVITY,
  MOCK_ACTIVE_WORKFLOWS,
  MOCK_CONVERSATION_DETAILS,
  MOCK_CUSTOMERS,
  MOCK_RECENT_CONVERSATIONS,
  MOCK_TOTALS,
  MOCK_VOLUME,
  MOCK_WORKFLOWS,
} from './mockData';

export function isDemoModeActive(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('wa_demo_session');
}

export function resolveMockResponse(path: string, method: string, body?: unknown): unknown {
  const cleanPath = path.split('?')[0].replace(/\/$/, '');

  // Auth endpoints
  if (cleanPath === '/auth/me') {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('wa_demo_session') : null;
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    return createDemoSession('owner');
  }

  if (cleanPath === '/auth/login') {
    const b = (body as { email?: string }) || {};
    let role: 'owner' | 'agent' | 'viewer' = 'owner';
    if (b.email?.includes('agent')) role = 'agent';
    else if (b.email?.includes('viewer')) role = 'viewer';
    const session = createDemoSession(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('wa_demo_session', JSON.stringify(session));
    }
    return session;
  }

  if (cleanPath === '/auth/logout') {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('wa_demo_session');
    }
    return { success: true };
  }

  // Dashboard
  if (cleanPath === '/dashboard') {
    return {
      isDemo: true,
      totals: MOCK_TOTALS,
      volume: MOCK_VOLUME,
      recentConversations: MOCK_RECENT_CONVERSATIONS,
      activeWorkflows: MOCK_ACTIVE_WORKFLOWS,
      activity: MOCK_ACTIVITY,
      failedExecutions: [],
    };
  }

  // Conversations
  if (cleanPath === '/conversations') {
    return {
      items: MOCK_RECENT_CONVERSATIONS,
      total: MOCK_RECENT_CONVERSATIONS.length,
      page: 1,
      pageSize: 50,
      hasMore: false,
    };
  }

  if (cleanPath.startsWith('/conversations/')) {
    const id = cleanPath.replace('/conversations/', '');
    if (id.endsWith('/messages')) {
      const b = (body as { body?: string }) || {};
      return {
        id: `msg-${Date.now()}`,
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        body: b.body || '',
        kind: 'text',
        payload: null,
        status: 'DELIVERED',
        error: null,
        intent: null,
        menuOptionId: null,
        executionId: null,
        createdAt: new Date().toISOString(),
      };
    }
    return MOCK_CONVERSATION_DETAILS[id] || MOCK_CONVERSATION_DETAILS['conv-1'];
  }

  // Customers
  if (cleanPath === '/customers') {
    return {
      items: MOCK_CUSTOMERS,
      total: MOCK_CUSTOMERS.length,
      page: 1,
      pageSize: 50,
      hasMore: false,
    };
  }

  if (cleanPath.startsWith('/customers/')) {
    const id = cleanPath.replace('/customers/', '');
    const found = MOCK_CUSTOMERS.find((c) => c.id === id) || MOCK_CUSTOMERS[0];
    return {
      ...found,
      notes: 'High loyalty score. Prefers WhatsApp notifications on weekends.',
      customFields: { pointsBalance: '2340', tier: 'Gold' },
      orders: [
        {
          id: 'ord-101',
          orderNumber: 'ORD-8821',
          totalMinor: 499900,
          status: 'FULFILLED',
          itemSummary: 'Oslo Desk Lamp (Gold Tier 10% applied)',
          createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        },
      ],
      conversations: [
        {
          id: 'conv-1',
          status: 'AUTOMATED',
          lastMessageAt: new Date().toISOString(),
          lastMessagePreview: 'Done! ₹50 discount applied.',
        },
      ],
    };
  }

  // Automations / Workflows
  if (cleanPath === '/automations' || cleanPath === '/workflows') {
    return MOCK_WORKFLOWS;
  }

  // Analytics
  if (cleanPath.startsWith('/analytics')) {
    return {
      totals: MOCK_TOTALS,
      volume: MOCK_VOLUME,
    };
  }

  // Business profile
  if (cleanPath.startsWith('/business')) {
    return {
      displayName: 'Threadline Loyalty Club',
      isDemo: true,
      timezone: 'Asia/Kolkata',
      contactPhone: '+91 98765 43210',
      description: 'Automated WhatsApp loyalty rewards program.',
    };
  }

  // Fallback generic object
  return { isDemo: true, ok: true };
}
