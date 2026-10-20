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
  const [pathname, search] = path.split('?');
  const cleanPath = pathname.replace(/\/$/, '');
  const params = new URLSearchParams(search || '');

  // Auth endpoints
  if (cleanPath === '/auth/me') {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('wa_demo_session') : null;
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    return null;
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

  // Conversations (Inbox)
  if (cleanPath === '/conversations') {
    return {
      data: MOCK_RECENT_CONVERSATIONS,
      total: MOCK_RECENT_CONVERSATIONS.length,
      page: 1,
      pageSize: 50,
    };
  }

  if (cleanPath.startsWith('/conversations/')) {
    const sub = cleanPath.replace('/conversations/', '');
    if (sub.endsWith('/messages')) {
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
    const convId = sub.split('/')[0];
    return MOCK_CONVERSATION_DETAILS[convId] || MOCK_CONVERSATION_DETAILS['conv-1'];
  }

  // Customers
  if (cleanPath === '/customers') {
    return {
      data: MOCK_CUSTOMERS,
      tags: [
        { id: 't1', name: 'gold-tier' },
        { id: 't2', name: 'vip' },
        { id: 't3', name: 'silver-tier' },
        { id: 't4', name: 'referral-hero' },
        { id: 't5', name: 'platinum-tier' },
      ],
      total: MOCK_CUSTOMERS.length,
      page: 1,
      pageSize: 50,
    };
  }

  if (cleanPath.startsWith('/customers/')) {
    const id = cleanPath.replace('/customers/', '');
    const found = MOCK_CUSTOMERS.find((c) => c.id === id) || MOCK_CUSTOMERS[0];
    return {
      ...found,
      notes: 'Active loyalty club member. 2,340 points balance.',
      customFields: { pointsBalance: '2340', tier: 'Gold', preferredReward: '₹50 discount' },
      orders: [
        {
          id: 'ord-101',
          number: 'ORD-8821',
          totalMinor: 499900,
          currency: 'INR',
          status: 'DELIVERED',
          items: [{ sku: 'LMP-ARC', name: 'Arc Floor Lamp (Points Applied)', quantity: 1, priceMinor: 499900 }],
          createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        },
      ],
      conversations: [
        {
          id: 'conv-1',
          createdAt: new Date(Date.now() - 6 * 60000).toISOString(),
          status: 'AUTOMATED',
          lastMessagePreview: 'Done! ₹50 discount applied.',
        },
      ],
    };
  }

  // Leads
  if (cleanPath === '/leads') {
    return [
      {
        id: 'lead-1',
        status: 'QUALIFIED',
        interest: 'Corporate Diwali Gifting: 50 Gift Hampers',
        notes: 'Requested tier discount on bulk purchase',
        details: { company: 'Infosys Team', quantity: 50 },
        valueMinor: 12500000,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date().toISOString(),
        customer: { id: 'cust-1', name: 'Priya Sharma', waId: '919876543210' },
      },
      {
        id: 'lead-2',
        status: 'NEW',
        interest: 'In-store Gold Tier consultation',
        notes: 'Inquiring about wedding registry rewards',
        details: { store: 'Indiranagar' },
        valueMinor: 4500000,
        createdAt: new Date(Date.now() - 14400000).toISOString(),
        updatedAt: new Date().toISOString(),
        customer: { id: 'cust-3', name: 'Meera Joshi', waId: '919765432109' },
      },
    ];
  }

  // Workflows / Automations
  if (cleanPath === '/workflows' || cleanPath === '/automations') {
    return MOCK_WORKFLOWS;
  }

  if (cleanPath.startsWith('/workflows/')) {
    const id = cleanPath.replace('/workflows/', '').split('/')[0];
    const wf = MOCK_WORKFLOWS.find((w) => w.id === id) || MOCK_WORKFLOWS[0];
    return {
      ...wf,
      activeVersionId: 'v1',
      latestVersionId: 'v1',
      definition: {
        trigger: { type: 'keyword', keywords: ['points', 'balance'], match: 'contains' },
        steps: [
          { id: 's1', type: 'send_text', text: 'Hi! Checking your current points balance...' },
          { id: 's2', type: 'business_action', action: 'check_product_availability', params: {} },
        ],
      },
      versions: [{ id: 'v1', version: 1, createdAt: new Date().toISOString() }],
      validation: { ok: true, errors: [], warnings: [] },
    };
  }

  // Menus
  if (cleanPath === '/menus') {
    return [
      {
        id: 'menu-1',
        name: 'Main Loyalty Menu',
        header: 'Threadline Loyalty Club',
        body: 'Welcome! How can we reward you today?',
        buttonLabel: 'View Options',
        isDefault: true,
        isPublished: true,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        options: [
          { id: 'opt-1', position: 1, title: 'Check Point Balance', description: 'See your current points and tier', actionType: 'REPLY', actionConfig: {} },
          { id: 'opt-2', position: 2, title: 'Redeem Points for Discount', description: 'Exchange 500 pts for ₹50 off', actionType: 'REPLY', actionConfig: {} },
          { id: 'opt-3', position: 3, title: 'Invite Friends (+200 pts)', description: 'Share your referral code', actionType: 'REPLY', actionConfig: {} },
          { id: 'opt-4', position: 4, title: 'Talk to Support', description: 'Connect with a live agent', actionType: 'HANDOFF', actionConfig: {} },
        ],
      },
    ];
  }

  // Products
  if (cleanPath === '/products') {
    return [
      { id: 'p1', sku: 'LMP-ARC', name: 'Arc Floor Lamp', category: 'Lighting', priceMinor: 749900, currency: 'INR', stock: 6 },
      { id: 'p2', sku: 'FUR-ACC', name: 'Rattan Accent Chair', category: 'Furniture', priceMinor: 1249900, currency: 'INR', stock: 3 },
      { id: 'p3', sku: 'DEC-VASE', name: 'Terracotta Vase Set', category: 'Decor', priceMinor: 159900, currency: 'INR', stock: 22 },
    ];
  }

  if (cleanPath === '/products/categories') {
    return ['Lighting', 'Furniture', 'Decor', 'Rewards'];
  }

  // Analytics
  if (cleanPath.startsWith('/analytics')) {
    return {
      totals: MOCK_TOTALS,
      volume: MOCK_VOLUME,
    };
  }

  // Business Profile
  if (cleanPath.startsWith('/business')) {
    return {
      displayName: 'Threadline Loyalty Club',
      isDemo: true,
      timezone: 'Asia/Kolkata',
      contactPhone: '+91 98765 43210',
      description: 'WhatsApp loyalty and points automation platform.',
    };
  }

  // Simulator
  if (cleanPath === '/simulator/info') {
    return {
      note: 'WhatsApp Simulator is active and ready.',
      whatsappMode: 'SIMULATED',
      samples: [
        { name: 'Check Points', from: '+91 98765 43210', text: 'How many points do I have?' },
        { name: 'Redeem Reward', from: '+91 98765 43210', text: 'Redeem 500 points' },
        { name: 'Tier Benefits', from: '+91 98765 43210', text: 'What are my tier benefits?' },
        { name: 'Referral Bonus', from: '+91 98765 43210', text: 'Share my referral code' },
      ],
    };
  }

  if (cleanPath === '/simulator/thread') {
    const waId = params.get('waId') || '919876543210';
    return {
      customer: { id: 'cust-sim', name: 'Priya Sharma', waId },
      conversation: { id: 'conv-sim', status: 'AUTOMATED' as const },
      messages: MOCK_CONVERSATION_DETAILS['conv-1'].messages,
    };
  }

  if (cleanPath === '/simulator/messages') {
    const b = (body as { text?: string; from?: string }) || {};
    const text = b.text || 'Hello';
    const waId = (b.from || '+91 98765 43210').replace(/\D/g, '');

    const replyText = text.toLowerCase().includes('redeem')
      ? '🎉 ₹50 discount voucher applied! Code: SAVE50-PRIYA. Your new points balance is 2,340 pts.'
      : text.toLowerCase().includes('point') || text.toLowerCase().includes('balance')
      ? 'Hi Priya! You currently have 2,840 points (Gold Status). You are 160 points away from Platinum!'
      : text.toLowerCase().includes('refer')
      ? 'Your referral code is PRIYA200. Share with friends — they get ₹100 off and you get 200 points!'
      : `Thanks for messaging Threadline Club! We received: "${text}". Type "points" to check your balance or "redeem" for rewards.`;

    return {
      customer: { id: 'cust-sim', name: 'Priya Sharma', waId },
      conversation: { id: 'conv-sim', status: 'AUTOMATED' as const },
      messages: [
        ...MOCK_CONVERSATION_DETAILS['conv-1'].messages,
        {
          id: `msg-${Date.now()}-in`,
          direction: 'INBOUND' as const,
          senderType: 'CUSTOMER' as const,
          body: text,
          kind: 'text',
          payload: null,
          status: 'READ' as const,
          error: null,
          intent: 'user_chat',
          menuOptionId: null,
          executionId: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: `msg-${Date.now()}-out`,
          direction: 'OUTBOUND' as const,
          senderType: 'AUTOMATION' as const,
          body: replyText,
          kind: 'text',
          payload: null,
          status: 'DELIVERED' as const,
          error: null,
          intent: null,
          menuOptionId: null,
          executionId: 'ex-auto',
          createdAt: new Date(Date.now() + 500).toISOString(),
        },
      ],
      outcome: {
        duplicate: false,
        handledBy: 'Loyalty Automated Bot',
        handedOff: false,
        conversationId: 'conv-sim',
      },
    };
  }

  // Settings & Integrations
  if (cleanPath === '/settings/integrations') {
    return {
      whatsapp: { status: 'connected', mode: 'SIMULATED' },
      ai: { effectiveProvider: 'mock_claude' },
    };
  }

  if (cleanPath === '/settings/profile') {
    return {
      displayName: 'Threadline Loyalty Club',
      description: 'WhatsApp loyalty points & rewards automation',
      timezone: 'Asia/Kolkata',
      contactPhone: '+91 98765 43210',
    };
  }

  if (cleanPath === '/settings/team') {
    return [
      { id: 'm1', name: 'Aditi Rao', email: 'owner@brightlane.test', role: 'OWNER', createdAt: '2026-08-01T00:00:00Z' },
      { id: 'm2', name: 'Meera Pillai', email: 'agent@brightlane.test', role: 'AGENT', createdAt: '2026-08-05T00:00:00Z' },
      { id: 'm3', name: 'Karan Shah', email: 'viewer@brightlane.test', role: 'VIEWER', createdAt: '2026-08-10T00:00:00Z' },
    ];
  }

  if (cleanPath.startsWith('/settings/audit')) {
    return {
      data: MOCK_ACTIVITY,
      total: MOCK_ACTIVITY.length,
      page: 1,
      pageSize: 30,
    };
  }

  // Knowledge base
  if (cleanPath.startsWith('/knowledge')) {
    return [
      {
        id: 'k1',
        category: 'POLICY',
        title: 'Points Redemption Terms',
        content: 'Points can be redeemed anytime on orders above ₹199. 500 points = ₹50 discount code.',
        keywords: ['redeem', 'discount', 'points'],
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'k2',
        category: 'POLICY',
        title: 'Tier Thresholds',
        content: 'Silver: 0-2,499 pts (1x earn). Gold: 2,500-4,999 pts (2x earn). Platinum: 5,000+ pts (3x earn + free shipping).',
        keywords: ['tier', 'gold', 'silver', 'platinum'],
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  // AI Assistant
  if (cleanPath.startsWith('/assistant')) {
    return {
      enabled: true,
      confidenceThreshold: 0.6,
      tone: 'Warm, helpful and brief. Explain loyalty perks clearly.',
      recentInteractions: [],
    };
  }

  return { ok: true, isDemo: true };
}
