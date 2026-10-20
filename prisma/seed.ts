/**
 * Demo seed: one demo business ("Brightlane Home", clearly flagged isDemo) with
 * configuration (menus, workflows, knowledge, products) and ~35 customer
 * conversations replayed through the real inbound pipeline with backdated
 * timestamps. Every dashboard metric is therefore derived from stored records.
 *
 * Re-running the seed deletes and recreates the demo organization only.
 */
import bcrypt from 'bcryptjs';
import { WorkflowDefinitionSchema, type WorkflowDefinitionInput } from '@wa/shared';
import { prisma, type Prisma } from '../apps/api/src/db';
import { DEFAULT_HOURS } from '../apps/api/src/lib/hours';
import { emitBusinessEvent } from '../apps/api/src/services/events';
import { handleInbound } from '../apps/api/src/services/inbound';
import { deliver } from '../apps/api/src/services/outbound';

export const DEMO_SLUG = 'brightlane-home';
export const DEMO_PASSWORD = 'Demo@12345';
const IST_OFFSET_MIN = 330;

/** A timestamp `daysAgo` days back at the given IST wall-clock time. */
function istAt(daysAgo: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + (hour * 60 + minute - IST_OFFSET_MIN) * 60_000);
}

async function reset() {
  const existing = await prisma.organization.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing) await prisma.organization.delete({ where: { id: existing.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@brightlane.test' } } });
}

async function createConfig() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const org = await prisma.organization.create({
    data: { name: 'Brightlane Home', slug: DEMO_SLUG, isDemo: true },
  });
  const users = [
    { email: 'owner@brightlane.test', name: 'Aditi Rao', role: 'OWNER' as const },
    { email: 'agent@brightlane.test', name: 'Meera Pillai', role: 'AGENT' as const },
    { email: 'viewer@brightlane.test', name: 'Karan Shah', role: 'VIEWER' as const },
  ];
  const created: Record<string, string> = {};
  for (const u of users) {
    const user = await prisma.user.create({ data: { email: u.email, name: u.name, passwordHash } });
    await prisma.organizationMembership.create({
      data: { userId: user.id, organizationId: org.id, role: u.role },
    });
    created[u.role] = user.id;
  }

  await prisma.businessProfile.create({
    data: {
      organizationId: org.id,
      displayName: 'Brightlane Home',
      description:
        'Home décor, lighting and furniture store in Bengaluru (Indiranagar) with delivery across India.',
      instructions:
        'Help customers find products, check stock and orders, and explain policies. Prices are in INR and include GST. Offer the main menu when the customer seems unsure.',
      tone: 'Warm, clear and brief. Use plain English, no emojis.',
      topics: [
        'Products and stock',
        'Orders and delivery',
        'Returns and refunds policy',
        'Store hours and location',
        'Pricing',
        'Bulk and corporate orders',
      ],
      escalationRules: ['refund', 'damaged', 'complaint', 'speak to a human', 'agent', 'manager', 'legal'],
      approvedActions: [
        'search_knowledge',
        'check_product_availability',
        'check_order_status',
        'create_lead',
        'place_order',
      ],
      confidenceThreshold: 0.6,
      aiEnabled: true,
      timezone: 'Asia/Kolkata',
      businessHours: DEFAULT_HOURS,
      contactEmail: 'hello@brightlane.example',
      contactPhone: '+91 80 4000 1234',
      website: 'https://brightlane.example',
      notificationPrefs: { emailOnHandoff: true, emailDailySummary: true, notifyOnFailedWorkflow: true },
    },
  });

  const products = [
    ['LMP-ARC', 'Arc floor lamp', 'Lighting', 749900, 6, 'Brass arc lamp with linen shade, 180 cm'],
    ['LMP-DOME', 'Dome pendant light', 'Lighting', 329900, 14, 'Matte black metal pendant, 35 cm'],
    ['LMP-DESK', 'Oslo desk lamp', 'Lighting', 189900, 0, 'Adjustable oak and steel desk lamp'],
    ['LMP-STRING', 'Warm string lights', 'Lighting', 79900, 40, '10 m copper wire, warm white'],
    ['FUR-ACC', 'Rattan accent chair', 'Furniture', 1249900, 3, 'Hand-woven rattan with teak frame'],
    ['FUR-SIDE', 'Mango wood side table', 'Furniture', 549900, 8, 'Solid mango wood, 45 cm'],
    ['FUR-SHELF', 'Ladder bookshelf', 'Furniture', 899900, 5, 'Five-tier sheesham ladder shelf'],
    ['DEC-VASE', 'Terracotta vase set', 'Decor', 159900, 22, 'Set of three hand-thrown vases'],
    ['DEC-MIRROR', 'Round wall mirror', 'Decor', 429900, 9, '70 cm mirror with brass frame'],
    ['DEC-CLOCK', 'Minimal wall clock', 'Decor', 219900, 11, 'Silent sweep, walnut face'],
    ['TEX-CUSH', 'Linen cushion cover', 'Textiles', 89900, 60, '45 × 45 cm stonewashed linen'],
    ['TEX-THROW', 'Cotton throw blanket', 'Textiles', 249900, 18, 'Handloom cotton, 130 × 170 cm'],
  ] as const;
  for (const [sku, name, category, priceMinor, stock, description] of products) {
    await prisma.product.create({
      data: { organizationId: org.id, sku, name, category, priceMinor, stock, description },
    });
  }

  const knowledge = [
    [
      'FAQ',
      'Store hours',
      'We are open Monday to Friday 10 am–8 pm and Saturday 10 am–6 pm. We are closed on Sundays.',
      ['hours', 'timing', 'timings', 'open', 'close', 'sunday'],
    ],
    [
      'CONTACT',
      'Store location',
      'Our store is at 12, 100 Feet Road, Indiranagar, Bengaluru 560038. Parking is available on the side street.',
      ['address', 'location', 'where are you', 'store', 'directions'],
    ],
    [
      'POLICY',
      'Return policy',
      'You can return unused items within 7 days of delivery for a full refund. Furniture returns need a pickup, which we schedule for free. Items must be in original packaging.',
      ['return', 'returns', 'exchange', 'return policy'],
    ],
    [
      'POLICY',
      'Delivery charges',
      'Delivery is free on orders above ₹2,999. Smaller orders have a ₹149 delivery charge. Furniture delivery includes assembly in Bengaluru.',
      ['delivery charge', 'shipping cost', 'free delivery', 'delivery fee'],
    ],
    [
      'SERVICE',
      'Delivery areas and time',
      'We deliver across India. Bengaluru: 1–2 days. Metro cities including Pune, Mumbai, Delhi, Chennai and Hyderabad: 3–5 days. Other cities: 5–8 days.',
      ['deliver', 'delivery', 'pune', 'mumbai', 'delhi', 'chennai', 'hyderabad', 'how long'],
    ],
    [
      'POLICY',
      'Payment methods',
      'We accept UPI, debit and credit cards, net banking and cash on delivery for orders under ₹10,000.',
      ['payment', 'upi', 'card', 'cash on delivery', 'cod', 'pay'],
    ],
    [
      'SERVICE',
      'Bulk and corporate orders',
      'We offer volume pricing for offices, hotels and gifting from 20 units. Share your requirement and our sales team will send a quote within one working day.',
      ['bulk', 'corporate', 'office', 'wholesale', 'quote'],
    ],
    [
      'PRODUCT',
      'Lighting warranty',
      'All lamps and pendants carry a 1-year warranty against manufacturing defects. Bulbs are not covered.',
      ['warranty', 'guarantee', 'lamp warranty'],
    ],
    [
      'FAQ',
      'Gift wrapping',
      'Gift wrapping is available for ₹99 per item. Add a note in your order and we will include a handwritten card.',
      ['gift', 'wrap', 'wrapping', 'card'],
    ],
    [
      'PRODUCT',
      'Furniture care',
      'Wipe wood furniture with a dry cloth and avoid direct sunlight. Rattan can be cleaned with a soft brush.',
      ['care', 'clean', 'maintenance', 'polish'],
    ],
  ] as const;
  for (const [category, title, content, keywords] of knowledge) {
    await prisma.knowledgeEntry.create({
      data: { organizationId: org.id, category, title, content, keywords: [...keywords] },
    });
  }

  const wf = async (
    name: string,
    description: string,
    definition: WorkflowDefinitionInput,
    active = true,
    priority = 100,
  ) => {
    const def = WorkflowDefinitionSchema.parse(definition);
    const w = await prisma.workflow.create({
      data: {
        organizationId: org.id,
        name,
        description,
        priority,
        triggerType: def.trigger.type,
        versions: {
          create: { version: 1, definition: def as Prisma.InputJsonValue, createdById: created.OWNER },
        },
      },
      include: { versions: true },
    });
    if (active)
      await prisma.workflow.update({
        where: { id: w.id },
        data: { isActive: true, activeVersionId: w.versions[0].id },
      });
    return w;
  };

  const tracking = await wf(
    'Order tracking',
    'Asks for the order number and checks its status for this customer.',
    {
      trigger: {
        type: 'keyword',
        keywords: ['track', 'order status', 'where is my order'],
        match: 'contains',
      },
      steps: [
        {
          id: 'ask',
          type: 'ask_question',
          question: 'Please share your order number (for example ORD-1004).',
          variable: 'orderNumber',
        },
        {
          id: 'check',
          type: 'business_action',
          action: 'check_order_status',
          params: { orderNumber: '{{vars.orderNumber}}' },
        },
        { id: 'more', type: 'send_text', text: 'Anything else? Type MENU to see all options.' },
      ],
    },
  );

  // Menus: pricing first (main links to it), then main, then pricing's "back" option.
  const pricing = await prisma.menu.create({
    data: {
      organizationId: org.id,
      name: 'Pricing',
      header: 'Pricing',
      body: 'Which prices would you like to see?',
      buttonLabel: 'Choose a category',
      isPublished: true,
      publishedAt: new Date(),
      options: {
        create: [
          {
            position: 0,
            title: 'Lighting',
            description: 'Lamps, pendants and string lights',
            actionType: 'PRODUCT_LIST',
            actionConfig: { category: 'Lighting' },
          },
          {
            position: 1,
            title: 'Furniture',
            description: 'Chairs, tables and shelves',
            actionType: 'PRODUCT_LIST',
            actionConfig: { category: 'Furniture' },
          },
          {
            position: 2,
            title: 'Delivery charges',
            description: 'What delivery costs',
            actionType: 'REPLY',
            actionConfig: {
              text: 'Delivery is free above ₹2,999. Smaller orders have a ₹149 delivery charge.',
            },
          },
        ],
      },
    },
  });
  const main = await prisma.menu.create({
    data: {
      organizationId: org.id,
      name: 'Main menu',
      header: 'Brightlane Home',
      body: 'Welcome! How can we help you today?',
      buttonLabel: 'View options',
      isDefault: true,
      isPublished: true,
      publishedAt: new Date(),
      options: {
        create: [
          {
            position: 0,
            title: 'Browse products',
            description: 'See what is in stock',
            actionType: 'PRODUCT_LIST',
            actionConfig: {},
          },
          {
            position: 1,
            title: 'Track an order',
            description: 'Check your delivery status',
            actionType: 'RUN_WORKFLOW',
            actionConfig: { workflowId: tracking.id },
          },
          {
            position: 2,
            title: 'View pricing',
            description: 'Prices by category',
            actionType: 'SUBMENU',
            actionConfig: { menuId: pricing.id },
          },
          {
            position: 3,
            title: 'Talk to support',
            description: 'Chat with our team',
            actionType: 'HANDOFF',
            actionConfig: {
              note: 'Connecting you with our team. Someone will reply here within a few minutes during store hours.',
            },
          },
        ],
      },
    },
  });
  await prisma.menuOption.create({
    data: {
      menuId: pricing.id,
      position: 3,
      title: 'Back to main menu',
      description: '',
      actionType: 'SUBMENU',
      actionConfig: { menuId: main.id },
    },
  });

  await wf('Welcome new customers', 'Greets first-time customers, tags them and shows the main menu.', {
    trigger: { type: 'first_time_customer' },
    steps: [
      {
        id: 'greet',
        type: 'send_text',
        text: 'Hi {{customer.firstName}}, welcome to Brightlane Home. I can help with products, orders and delivery.',
      },
      { id: 'tag', type: 'add_tag', tag: 'new-customer' },
      { id: 'menu', type: 'send_menu', menuId: main.id },
    ],
  });
  await wf('Show main menu', 'Sends the main menu when a customer types MENU.', {
    trigger: { type: 'keyword', keywords: ['menu', 'options', 'start'], match: 'exact' },
    steps: [{ id: 'menu', type: 'send_menu', menuId: main.id }],
  });
  await wf('Store hours', 'Answers timing questions with an open/closed branch.', {
    trigger: {
      type: 'keyword',
      keywords: ['timing', 'timings', 'store hours', 'open today'],
      match: 'contains',
    },
    steps: [
      {
        id: 'open',
        type: 'condition',
        rules: [{ field: 'businessHours.open', op: 'is_true' }],
        onTrue: 'yes',
        onFalse: 'no',
      },
      {
        id: 'yes',
        type: 'send_text',
        text: "We're open now. Hours: Mon–Fri 10 am–8 pm, Sat 10 am–6 pm.",
        next: null,
      },
      {
        id: 'no',
        type: 'send_text',
        text: "We're closed right now. Hours: Mon–Fri 10 am–8 pm, Sat 10 am–6 pm. Leave a message and we'll reply when we open.",
      },
    ],
  });
  await wf('Bulk order enquiries', 'Qualifies bulk and corporate leads, then hands off to sales.', {
    trigger: { type: 'keyword', keywords: ['bulk', 'wholesale', 'corporate order'], match: 'contains' },
    steps: [
      {
        id: 'intro',
        type: 'send_text',
        text: 'Happy to help with a bulk order. A few quick questions so our sales team can quote.',
      },
      {
        id: 'details',
        type: 'collect_details',
        fields: [
          { variable: 'company', prompt: 'What is your company or organisation name?' },
          { variable: 'city', prompt: 'Which city should we deliver to?' },
          { variable: 'quantity', prompt: 'Roughly how many units do you need?', validation: 'number' },
          { variable: 'email', prompt: 'What email should we send the quote to?', validation: 'email' },
        ],
      },
      {
        id: 'lead',
        type: 'business_action',
        action: 'create_lead',
        params: {
          interest: 'Bulk order: {{vars.quantity}} units',
          details: '{{vars.company}}, {{vars.city}}, {{vars.email}}',
        },
      },
      { id: 'tag', type: 'add_tag', tag: 'bulk-lead' },
      {
        id: 'thanks',
        type: 'send_text',
        text: 'Thank you, {{customer.firstName}}. Our sales team will email a quote to {{vars.email}} within one working day.',
      },
      { id: 'handoff', type: 'assign_human', note: 'New bulk enquiry: follow up with a quote' },
    ],
  });
  await wf('After-hours reply', 'Lets customers know when the store is closed.', {
    trigger: { type: 'business_hours', when: 'outside' },
    steps: [
      {
        id: 'closed',
        type: 'send_text',
        text: "Thanks for your message. We're closed right now and will reply after 10 am. You can still browse our products below.",
      },
      { id: 'tag', type: 'add_tag', tag: 'after-hours' },
      { id: 'menu', type: 'send_menu', menuId: main.id },
    ],
  });
  await wf('Warranty check', 'Collects the product name for a warranty claim and checks the catalogue.', {
    trigger: { type: 'keyword', keywords: ['warranty claim'], match: 'contains' },
    steps: [
      {
        id: 'ask',
        type: 'ask_question',
        question: 'Which product is the warranty claim for? Please type the product name.',
        variable: 'product',
      },
      {
        id: 'lookup',
        type: 'business_action',
        action: 'check_product_availability',
        params: { query: '{{vars.product}}' },
      },
      { id: 'handoff', type: 'assign_human', note: 'Warranty claim to review' },
    ],
  });
  await wf('Order shipped notification', 'Messages the customer when an order is marked as shipped.', {
    trigger: { type: 'event', event: 'order.status_changed' },
    steps: [
      {
        id: 'shipped',
        type: 'condition',
        rules: [{ field: 'variable', variable: 'orderStatus', op: 'equals', value: 'shipped' }],
        onTrue: 'notify',
        onFalse: null,
      },
      {
        id: 'notify',
        type: 'send_text',
        text: 'Good news, {{customer.firstName}}: order {{vars.orderNumber}} has shipped. Reply TRACK any time to check its status.',
      },
    ],
  });
  await wf(
    'Feedback request (draft)',
    'Draft: ask for a rating after delivery. Not active yet.',
    {
      trigger: { type: 'keyword', keywords: ['feedback'], match: 'contains' },
      steps: [
        {
          id: 'ask',
          type: 'ask_question',
          question: 'How would you rate your experience from 1 to 5?',
          variable: 'rating',
          validation: 'number',
        },
        { id: 'thanks', type: 'send_text', text: 'Thank you for the feedback!' },
      ],
    },
    false,
  );

  return { org, users: created, main, pricing };
}

type Step =
  | { say: string; gap?: number }
  | { agent: string; gap?: number }
  | { order: { sku: string; qty: number; status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' } }
  | { ship: true; gap?: number }
  | { resolve: true };

interface Script {
  name: string;
  waId: string;
  daysAgo: number;
  hour: number;
  steps: Step[];
}

const CUSTOMERS: [string, string][] = [
  ['Ananya Krishnan', '919845100101'],
  ['Rahul Verma', '919845100102'],
  ['Priya Nair', '919845100103'],
  ['Aman Gupta', '919845100104'],
  ['Divya Menon', '919845100105'],
  ['Siddharth Jain', '919845100106'],
  ['Pooja Reddy', '919845100107'],
  ['Nikhil Joshi', '919845100108'],
  ['Shreya Das', '919845100109'],
  ['Varun Malhotra', '919845100110'],
  ['Lakshmi Iyer', '919845100111'],
  ['Kabir Singh', '919845100112'],
  ['Tanvi Kulkarni', '919845100113'],
  ['Harsh Agarwal', '919845100114'],
  ['Meghna Rao', '919845100115'],
  ['Imran Khan', '919845100116'],
  ['Ritika Bansal', '919845100117'],
  ['Arnav Chopra', '919845100118'],
  ['Neha Sinha', '919845100119'],
  ['Gaurav Pillai', '919845100120'],
  ['Zoya Ahmed', '919845100121'],
  ['Manish Patel', '919845100122'],
  ['Sneha Hegde', '919845100123'],
  ['Rohit Saxena', '919845100124'],
  ['Aisha Fernandes', '919845100125'],
  ['Kunal Desai', '919845100126'],
  ['Bhavna Shetty', '919845100127'],
  ['Dev Mukherjee', '919845100128'],
];

function scripts(): Script[] {
  const c = (i: number) => ({ name: CUSTOMERS[i][0], waId: CUSTOMERS[i][1] });
  const longSerial =
    'The lamp I bought last month with serial number BLH-2026-LMP-ARC-0045-BATCH-7781-QC-PASSED-BENGALURU-WAREHOUSE-RACK-14 stopped working';
  return [
    // Older history (for the 90-day range and returning customers)
    {
      ...c(0),
      daysAgo: 70,
      hour: 11,
      steps: [
        { say: 'Hi' },
        { say: '1' },
        { say: 'Do you have the Arc floor lamp in stock?' },
        { resolve: true },
      ],
    },
    {
      ...c(1),
      daysAgo: 62,
      hour: 15,
      steps: [{ say: 'Hello' }, { say: '3' }, { say: '2' }, { resolve: true }],
    },
    {
      ...c(2),
      daysAgo: 55,
      hour: 12,
      steps: [
        { say: 'Hi' },
        { order: { sku: 'TEX-THROW', qty: 1, status: 'DELIVERED' } },
        { say: '2' },
        { say: 'ORD-1001' },
        { resolve: true },
      ],
    },
    {
      ...c(3),
      daysAgo: 48,
      hour: 17,
      steps: [
        { say: 'Hi there' },
        { say: '4' },
        { agent: 'Hi Aman, this is Meera from Brightlane. How can I help?' },
        { say: 'Can you hold the rattan chair for me till Saturday?' },
        { agent: 'Done, it is reserved in your name until Saturday 6 pm.' },
        { resolve: true },
      ],
    },
    {
      ...c(4),
      daysAgo: 41,
      hour: 13,
      steps: [{ say: 'Hi' }, { say: 'What is your return policy?' }, { resolve: true }],
    },
    // Last 30 days
    {
      ...c(5),
      daysAgo: 29,
      hour: 11,
      steps: [
        { say: 'Hi' },
        { say: 'Browse products' },
        { say: 'Do you have pendant lights?' },
        { resolve: true },
      ],
    },
    {
      ...c(6),
      daysAgo: 27,
      hour: 16,
      steps: [
        { say: 'Hello' },
        { order: { sku: 'DEC-MIRROR', qty: 1, status: 'SHIPPED' } },
        { say: '2' },
        { say: 'ORD-1002' },
      ],
    },
    {
      ...c(7),
      daysAgo: 26,
      hour: 12,
      steps: [
        { say: 'We need a bulk order for our new office' },
        { say: 'Northwind Analytics' },
        { say: 'Pune' },
        { say: 'around forty' },
        { say: '40' },
        { say: 'admin@northwind.example' },
        { agent: 'Thanks Nikhil, I have emailed the quote. Let me know if you need samples.' },
        { resolve: true },
      ],
    },
    { ...c(0), daysAgo: 25, hour: 14, steps: [{ say: 'What are your store timings?' }, { resolve: true }] },
    { ...c(8), daysAgo: 24, hour: 21, steps: [{ say: 'Hi' }, { say: 'menu' }, { say: '3' }, { say: '3' }] },
    {
      ...c(9),
      daysAgo: 22,
      hour: 12,
      steps: [{ say: 'Hi' }, { say: 'order 2 linen cushion cover' }, { say: 'YES' }, { resolve: true }],
    },
    {
      ...c(10),
      daysAgo: 21,
      hour: 18,
      steps: [
        { say: 'Hello' },
        { say: 'I want a refund, the vase arrived damaged' },
        {
          agent:
            'So sorry about that, Lakshmi. Could you share a photo? We will arrange a replacement or refund today.',
        },
        { say: 'Sent the photo on email' },
        { agent: 'Got it. Refund of ₹1,599 initiated, you will see it in 3–5 days.' },
        { resolve: true },
      ],
    },
    { ...c(1), daysAgo: 20, hour: 11, steps: [{ say: 'Do you deliver to Pune?' }, { resolve: true }] },
    {
      ...c(11),
      daysAgo: 19,
      hour: 15,
      steps: [
        { say: 'Hi' },
        { say: 'Can you design my whole living room?' },
        { agent: 'Hi Kabir, we offer free styling advice in store. Would Saturday at 11 work?' },
        { say: 'Yes, see you then' },
        { resolve: true },
      ],
    },
    { ...c(12), daysAgo: 18, hour: 13, steps: [{ say: 'Hi' }, { say: '2' }, { say: 'ORD-9999' }] },
    {
      ...c(13),
      daysAgo: 17,
      hour: 10,
      steps: [{ say: 'Hi' }, { say: 'warranty claim' }, { say: longSerial }],
    },
    {
      ...c(4),
      daysAgo: 16,
      hour: 12,
      steps: [{ say: 'What payment methods do you accept?' }, { resolve: true }],
    },
    {
      ...c(14),
      daysAgo: 15,
      hour: 19,
      steps: [{ say: 'Hi' }, { say: '1' }, { say: 'Is the Oslo desk lamp available?' }],
    },
    {
      ...c(15),
      daysAgo: 14,
      hour: 11,
      steps: [
        { say: 'Hello' },
        { order: { sku: 'FUR-SIDE', qty: 1, status: 'CONFIRMED' } },
        { ship: true, gap: 600 },
        { say: 'track' },
        { say: 'ORD-1004' },
        { resolve: true },
      ],
    },
    { ...c(16), daysAgo: 13, hour: 22, steps: [{ say: 'Hi' }, { say: 'Is gift wrapping available?' }] },
    {
      ...c(17),
      daysAgo: 12,
      hour: 14,
      steps: [
        { say: 'Hi' },
        { say: 'corporate order for 25 clocks for gifting' },
        { say: 'Chopra Associates' },
        { say: 'Bengaluru' },
        { say: '25' },
        { say: 'arnav@chopra.example' },
      ],
    },
    {
      ...c(2),
      daysAgo: 11,
      hour: 12,
      steps: [{ say: 'How do I clean rattan furniture?' }, { resolve: true }],
    },
    {
      ...c(18),
      daysAgo: 10,
      hour: 16,
      steps: [
        { say: 'Hi' },
        { say: '4' },
        { agent: 'Hi Neha, Meera here. How can I help?' },
        { say: 'Need help choosing a lamp for a reading corner' },
        { agent: 'The Arc floor lamp works well for that. Want me to reserve one?' },
      ],
    },
    {
      ...c(19),
      daysAgo: 9,
      hour: 13,
      steps: [{ say: 'Hello' }, { say: 'Do you have terracotta vases?' }, { resolve: true }],
    },
    {
      ...c(20),
      daysAgo: 8,
      hour: 12,
      steps: [{ say: 'Hi' }, { say: 'buy 1 round wall mirror' }, { say: 'no' }, { resolve: true }],
    },
    { ...c(5), daysAgo: 7, hour: 15, steps: [{ say: 'Where is your store located?' }, { resolve: true }] },
    {
      ...c(21),
      daysAgo: 6,
      hour: 11,
      steps: [
        { say: 'Hi' },
        { say: 'I want to speak to a manager about my delivery' },
        { agent: 'Hi Manish, I am the store manager. Sorry for the delay, your order leaves today.' },
      ],
    },
    { ...c(22), daysAgo: 5, hour: 14, steps: [{ say: 'Hi' }, { say: '3' }, { say: '1' }, { resolve: true }] },
    {
      ...c(23),
      daysAgo: 4,
      hour: 12,
      steps: [
        { say: 'Hello' },
        { order: { sku: 'LMP-DOME', qty: 2, status: 'CONFIRMED' } },
        { say: 'where is my order' },
        { say: 'ORD-1005' },
      ],
    },
    {
      ...c(24),
      daysAgo: 3,
      hour: 17,
      steps: [
        { say: 'Hi' },
        { say: 'Do you have the warm string lights?' },
        { say: 'order 3 warm string lights' },
        { say: 'yes' },
      ],
    },
    { ...c(9), daysAgo: 2, hour: 13, steps: [{ say: 'What is the delivery charge for one cushion?' }] },
    {
      ...c(25),
      daysAgo: 2,
      hour: 20,
      steps: [{ say: 'Hi' }, { say: 'Is there any discount on the bookshelf?' }],
    },
    { ...c(26), daysAgo: 1, hour: 11, steps: [{ say: 'Hi' }, { say: '1' }] },
    { ...c(27), daysAgo: 0, hour: 10, steps: [{ say: 'Hello' }, { say: 'What are your timings today?' }] },
    { ...c(11), daysAgo: 0, hour: 11, steps: [{ say: 'Hi again, do you have rattan chairs in stock?' }] },
  ];
}

async function replay(orgId: string, agentId: string) {
  let n = 0;
  for (const s of scripts().sort((a, b) => b.daysAgo - a.daysAgo || a.hour - b.hour)) {
    let t = istAt(s.daysAgo, s.hour, 5 + (n % 40));
    let customerId: string | null = null;
    let conversationId: string | null = null;
    for (const step of s.steps) {
      const gap = ('gap' in step && step.gap) || 75 + (n++ % 5) * 25;
      t = new Date(t.getTime() + gap * 1000);
      if (t.getTime() > Date.now()) t = new Date(Date.now() - 60_000);
      if ('say' in step) {
        const r = await handleInbound(orgId, {
          waId: s.waId,
          name: s.name,
          text: step.say,
          externalId: `seed_${s.waId}_${t.getTime()}`,
          channel: 'SIMULATED',
          at: t,
        });
        if (!r.duplicate) {
          customerId = r.customerId;
          conversationId = r.conversationId;
        }
      } else if ('agent' in step && conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'NEEDS_HUMAN', assignedToUserId: agentId, state: { type: 'none' } },
        });
        await deliver(conversationId, [{ kind: 'text', text: step.agent }], {
          sender: 'AGENT',
          at: t,
          meta: { agentId },
        });
      } else if ('order' in step && customerId) {
        const p = await prisma.product.findFirstOrThrow({
          where: { organizationId: orgId, sku: step.order.sku },
        });
        const count = await prisma.order.count({ where: { organizationId: orgId } });
        await prisma.order.create({
          data: {
            organizationId: orgId,
            customerId,
            number: `ORD-${1001 + count}`,
            status: step.order.status,
            items: [{ sku: p.sku, name: p.name, quantity: step.order.qty, priceMinor: p.priceMinor }],
            totalMinor: p.priceMinor * step.order.qty,
            createdAt: new Date(t.getTime() - 3 * 864e5),
          },
        });
      } else if ('ship' in step && customerId) {
        const order = await prisma.order.findFirstOrThrow({
          where: { organizationId: orgId, customerId },
          orderBy: { createdAt: 'desc' },
        });
        await prisma.order.update({ where: { id: order.id }, data: { status: 'SHIPPED' } });
        await emitBusinessEvent(orgId, 'order.status_changed', {
          customerId,
          entityId: `${order.id}:SHIPPED`,
          variables: { orderNumber: order.number, orderStatus: 'shipped' },
        });
      } else if ('resolve' in step && conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'RESOLVED', unreadCount: 0, state: { type: 'none' } },
        });
      }
    }
    if (conversationId && s.daysAgo > 3)
      await prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
  }
}

async function main() {
  console.log('Seeding demo organization "Brightlane Home"…');
  await reset();
  const { org, users } = await createConfig();
  await replay(org.id, users.AGENT);
  const [customers, conversations, messages, executions] = await Promise.all([
    prisma.customer.count({ where: { organizationId: org.id } }),
    prisma.conversation.count({ where: { organizationId: org.id } }),
    prisma.message.count({ where: { organizationId: org.id } }),
    prisma.workflowExecution.count({ where: { organizationId: org.id } }),
  ]);
  console.log(
    `Done: ${customers} customers, ${conversations} conversations, ${messages} messages, ${executions} workflow executions.`,
  );
  console.log(`Sign in: owner@brightlane.test / ${DEMO_PASSWORD} (also agent@ and viewer@)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
