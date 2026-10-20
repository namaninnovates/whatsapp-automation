import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';

const SECTIONS = [
  {
    title: 'Running locally',
    body: 'Install dependencies, start PostgreSQL with Docker Compose, apply migrations and seed the demo workspace. The README in the repository lists every command.',
    code: 'npm install\nnpm run db:up\nnpm run db:migrate\nnpm run db:seed\nnpm run dev',
  },
  {
    title: 'Simulated vs real WhatsApp',
    body: 'Without credentials the platform uses a simulated channel: messages go through the real automation engine and are stored, but nothing is sent to WhatsApp. Set WHATSAPP_MODE=cloud with your phone number ID, access token, app secret and verify token to use the Cloud API.',
    code: 'WHATSAPP_MODE=cloud\nWHATSAPP_PHONE_NUMBER_ID=…\nWHATSAPP_ACCESS_TOKEN=…\nWHATSAPP_APP_SECRET=…\nWHATSAPP_VERIFY_TOKEN=…',
  },
  {
    title: 'Webhook',
    body: 'Point the Meta app webhook at /api/webhooks/whatsapp on a public HTTPS URL and subscribe to the "messages" field. Requests without a valid X-Hub-Signature-256 are rejected.',
    code: 'GET  /api/webhooks/whatsapp   verification handshake\nPOST /api/webhooks/whatsapp   messages and statuses',
  },
  {
    title: 'AI provider',
    body: 'The assistant runs on a deterministic mock unless AI_PROVIDER, AI_API_KEY and AI_MODEL are set on the server. Keys are never sent to the browser.',
    code: 'AI_PROVIDER=anthropic   # or openai\nAI_API_KEY=…\nAI_MODEL=…',
  },
];

export function DocsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[820px] items-center justify-between px-6">
          <Link to="/">
            <Logo />
          </Link>
          <Link to="/login" className="text-[13.5px] font-medium">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[820px] px-6 py-12">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Documentation</h1>
        <p className="mt-2 text-[14.5px] text-ink-2">
          A short overview. The repository's docs folder covers the architecture, API, workflow engine and
          WhatsApp setup in detail.
        </p>
        <div className="mt-10 space-y-10">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-[16px] font-semibold">{s.title}</h2>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{s.body}</p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-[12.5px] text-ink-2">
                {s.code}
              </pre>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
