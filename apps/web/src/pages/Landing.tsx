import {
  ArrowRight,
  BarChart3,
  Bot,
  Gift,
  MessageCircle,
  Sparkles,
  Star,
  Trophy,
  Zap,
  Check,
  ChevronRight,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from '../components/Logo';

/* ───────────────────────────────────────────────────── types / data ─── */

interface Msg { from: 'user' | 'bot'; text: string; delay: number }

const CHAT_FLOWS: Record<string, Msg[]> = {
  redeem: [
    { from: 'user', text: 'How many points do I have?', delay: 0 },
    { from: 'bot', text: 'Hi Priya! You have 2,840 points — 160 away from Gold status.', delay: 900 },
    { from: 'user', text: 'Redeem 500 points', delay: 1900 },
    { from: 'bot', text: 'Done! ₹50 discount applied to your next order. Balance: 2,340 pts.', delay: 2800 },
  ],
  tier: [
    { from: 'user', text: 'What are my tier benefits?', delay: 0 },
    { from: 'bot', text: "You're on Silver tier. Upgrade to Gold in 160 pts for 2× earn rate + early access.", delay: 900 },
    { from: 'user', text: 'How do I reach Gold faster?', delay: 1900 },
    { from: 'bot', text: 'Refer a friend (+200 pts), leave a review (+100 pts), or make a purchase today!', delay: 2800 },
  ],
  referral: [
    { from: 'user', text: 'Share my referral code', delay: 0 },
    { from: 'bot', text: 'Your code is PRIYA200. Share it on WhatsApp — your friend gets ₹100 off and you earn 200 pts.', delay: 900 },
    { from: 'user', text: 'My friend Meera just signed up!', delay: 1900 },
    { from: 'bot', text: '🎉 200 pts added to your account! New balance: 3,040 pts. You are now Gold!', delay: 2800 },
  ],
};

const FEATURES = [
  { icon: Star, title: 'Points on every purchase', text: 'Auto-credit points for orders, referrals, reviews, and birthdays. No code needed.' },
  { icon: Gift, title: 'One-tap WhatsApp redemption', text: 'Customers type "redeem" and pick a reward in seconds. No app, no login.' },
  { icon: Trophy, title: 'Tiered membership', text: 'Bronze → Silver → Gold → Platinum. Each tier unlocks better rates and exclusive rewards.' },
  { icon: Sparkles, title: 'AI-personalised campaigns', text: 'Tailored double-points events, birthday offers and win-back messages — sent automatically.' },
  { icon: Zap, title: 'Viral referral engine', text: 'Unique share codes. When a friend orders, both accounts earn bonus points instantly.' },
  { icon: BarChart3, title: 'Live analytics', text: 'Redemption rates, revenue lift, tier distribution — refreshed in real time.' },
];

const STATS = [
  { value: '3.2×', label: 'higher redemption than email' },
  { value: '94%', label: 'WhatsApp open rate' },
  { value: '28%', label: 'average revenue lift' },
  { value: '<1s', label: 'points credit time' },
];

/* ───────────────────────────────────────────────── Logo ─── */

function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span style={{
        display:'flex', width:28, height:28, borderRadius:8,
        background:'linear-gradient(135deg,#34d399,#059669)',
        alignItems:'center', justifyContent:'center',
        boxShadow:'0 4px 12px rgba(52,211,153,0.35)',
      }}>
        <LogoMark className="size-4 [&_rect]:fill-transparent [&_path]:stroke-white" />
      </span>
      <span style={{ fontSize:15, fontWeight:700, letterSpacing:'-0.01em', color:'#fff' }}>Threadline</span>
    </span>
  );
}

/* ───────────────────────────────────────────────── Animated chat demo ─── */

function AnimatedChat({ flowKey }: { flowKey: string }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const msgs = CHAT_FLOWS[flowKey] ?? CHAT_FLOWS.redeem;
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
    setVisibleCount(0);
    msgs.forEach((m, i) => {
      const t = setTimeout(() => setVisibleCount(i + 1), m.delay);
      timerRefs.current.push(t);
    });
    return () => timerRefs.current.forEach(clearTimeout);
  }, [flowKey]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, padding:'16px 14px' }}>
      {msgs.slice(0, visibleCount).map((m, i) => (
        <div
          key={i}
          style={{
            display:'flex',
            justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start',
            animation: 'msgIn 220ms ease-out both',
          }}
        >
          {m.from === 'bot' && (
            <span style={{
              display:'flex', alignItems:'center', justifyContent:'center',
              width:26, height:26, borderRadius:'50%', flexShrink:0,
              background:'rgba(52,211,153,0.15)', marginRight:6, marginTop:2,
              border:'1px solid rgba(52,211,153,0.3)',
            }}>
              <Bot size={13} color="#34d399" />
            </span>
          )}
          <div style={{
            maxWidth:'76%',
            padding:'8px 12px',
            borderRadius: m.from === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            fontSize:13.5,
            lineHeight:1.45,
            background: m.from === 'user'
              ? 'linear-gradient(135deg,#059669,#047857)'
              : 'rgba(255,255,255,0.07)',
            color: m.from === 'user' ? '#fff' : 'rgba(255,255,255,0.88)',
            border: m.from === 'user' ? 'none' : '1px solid rgba(255,255,255,0.09)',
            boxShadow: m.from === 'user' ? '0 2px 8px rgba(5,150,105,0.25)' : 'none',
          }}>
            {m.text}
          </div>
        </div>
      ))}
      {visibleCount > 0 && visibleCount < msgs.length && (
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            width:26, height:26, borderRadius:'50%', flexShrink:0,
            background:'rgba(52,211,153,0.15)',
            border:'1px solid rgba(52,211,153,0.3)',
          }}>
            <Bot size={13} color="#34d399" />
          </span>
          <div style={{
            padding:'8px 14px', borderRadius:'16px 16px 16px 4px',
            background:'rgba(255,255,255,0.07)',
            border:'1px solid rgba(255,255,255,0.09)',
            display:'flex', gap:4, alignItems:'center',
          }}>
            {[0,1,2].map(j => (
              <span key={j} style={{
                width:6, height:6, borderRadius:'50%',
                background:'rgba(255,255,255,0.35)',
                display:'inline-block',
                animation:`typing 1.2s ${j*0.2}s ease-in-out infinite`,
              }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────── Phone mockup ─── */

type FlowKey = 'redeem' | 'tier' | 'referral';

function PhoneDemo() {
  const [activeFlow, setActiveFlow] = useState<FlowKey>('redeem');
  const tabs: { key: FlowKey; label: string }[] = [
    { key: 'redeem', label: 'Redeem' },
    { key: 'tier', label: 'Tiers' },
    { key: 'referral', label: 'Referrals' },
  ];

  return (
    <div style={{ position:'relative' }}>
      {/* glow halo */}
      <div style={{
        position:'absolute', inset:'-30px', borderRadius:'50%',
        background:'radial-gradient(ellipse, rgba(52,211,153,0.18) 0%, transparent 70%)',
        pointerEvents:'none',
      }} />

      {/* tab switcher above phone */}
      <div style={{ display:'flex', justifyContent:'center', gap:6, marginBottom:16 }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveFlow(key)}
            style={{
              padding:'5px 14px',
              borderRadius:20,
              fontSize:12.5,
              fontWeight:600,
              cursor:'pointer',
              transition:'all 180ms',
              border: activeFlow === key ? 'none' : '1px solid rgba(255,255,255,0.1)',
              background: activeFlow === key ? 'linear-gradient(135deg,#34d399,#059669)' : 'transparent',
              color: activeFlow === key ? '#fff' : 'rgba(255,255,255,0.45)',
              boxShadow: activeFlow === key ? '0 4px 12px rgba(52,211,153,0.3)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Phone shell */}
      <div style={{
        width:300,
        borderRadius:28,
        overflow:'hidden',
        border:'1.5px solid rgba(255,255,255,0.1)',
        background:'#111318',
        boxShadow:'0 32px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        margin:'0 auto',
      }}>
        {/* WA header */}
        <div style={{
          background:'linear-gradient(135deg,#075e54,#128c7e)',
          padding:'12px 14px 12px',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <div style={{
            width:38, height:38, borderRadius:'50%',
            background:'rgba(255,255,255,0.15)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:14, fontWeight:700, color:'#fff',
            border:'1.5px solid rgba(255,255,255,0.2)',
          }}>LP</div>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>LoyaltyBot</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'#4ade80', display:'inline-block' }} />
              online
            </div>
          </div>
        </div>

        {/* chat area */}
        <div style={{ minHeight:280, background:'#0d1117' }}>
          <AnimatedChat flowKey={activeFlow} />
        </div>

        {/* input bar */}
        <div style={{
          padding:'10px 12px',
          background:'rgba(255,255,255,0.03)',
          borderTop:'1px solid rgba(255,255,255,0.06)',
          display:'flex', alignItems:'center', gap:8,
        }}>
          <div style={{
            flex:1, padding:'7px 12px', borderRadius:20,
            background:'rgba(255,255,255,0.07)',
            border:'1px solid rgba(255,255,255,0.08)',
            fontSize:12.5, color:'rgba(255,255,255,0.25)',
          }}>
            Type a message…
          </div>
          <div style={{
            width:32, height:32, borderRadius:'50%',
            background:'linear-gradient(135deg,#34d399,#059669)',
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 2px 8px rgba(52,211,153,0.3)',
          }}>
            <ArrowRight size={14} color="#fff" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────── Feature tabs ─── */

function FeatureGrid() {
  const [active, setActive] = useState(0);
  return (
    <div style={{ display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))' }}>
      {FEATURES.map(({ icon: Icon, title, text }, i) => (
        <button
          key={title}
          onClick={() => setActive(i)}
          style={{
            textAlign:'left',
            padding:'20px 22px',
            borderRadius:16,
            cursor:'pointer',
            transition:'all 220ms',
            border: active === i ? '1.5px solid rgba(52,211,153,0.45)' : '1.5px solid rgba(255,255,255,0.06)',
            background: active === i
              ? 'linear-gradient(135deg, rgba(52,211,153,0.1) 0%, rgba(5,150,105,0.05) 100%)'
              : 'rgba(255,255,255,0.025)',
            boxShadow: active === i ? '0 0 0 4px rgba(52,211,153,0.06)' : 'none',
          }}
        >
          <div style={{
            width:38, height:38, borderRadius:10,
            background: active === i ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)',
            border: active === i ? '1px solid rgba(52,211,153,0.35)' : '1px solid rgba(255,255,255,0.08)',
            display:'flex', alignItems:'center', justifyContent:'center',
            marginBottom:12, transition:'all 220ms',
          }}>
            <Icon size={17} color={active === i ? '#34d399' : 'rgba(255,255,255,0.4)'} strokeWidth={1.75} />
          </div>
          <div style={{ fontSize:14.5, fontWeight:600, color: active === i ? '#fff' : 'rgba(255,255,255,0.7)', marginBottom:6 }}>
            {title}
          </div>
          <div style={{ fontSize:13, lineHeight:1.6, color: active === i ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.35)' }}>
            {text}
          </div>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────── Page ─── */

export function LandingPage() {
  useEffect(() => {
    const origHtmlBg = document.documentElement.style.backgroundColor;
    const origBodyBg = document.body.style.backgroundColor;
    const origHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    const origBodyOverscroll = document.body.style.overscrollBehavior;

    document.documentElement.style.backgroundColor = '#0a0b0f';
    document.body.style.backgroundColor = '#0a0b0f';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';

    return () => {
      document.documentElement.style.backgroundColor = origHtmlBg;
      document.body.style.backgroundColor = origBodyBg;
      document.documentElement.style.overscrollBehavior = origHtmlOverscroll;
      document.body.style.overscrollBehavior = origBodyOverscroll;
    };
  }, []);

  return (
    <div style={{ minHeight:'100vh', background:'#0a0b0f', color:'#e2e8f0', fontFamily:"'Inter Variable', sans-serif", overflowX:'hidden' }}>

      {/* ── Global keyframes injected via style tag ── */}
      <style>{`
        html, body {
          background-color: #0a0b0f !important;
          overscroll-behavior: none !important;
          overscroll-behavior-y: none !important;
          -webkit-overscroll-behavior: none !important;
          margin: 0;
          padding: 0;
        }
        /* Hide scrollbars to eliminate edge tears at top and bottom */
        html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }
        html, body, * {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        @keyframes msgIn {
          from { opacity:0; transform:translateY(6px) scale(0.97); }
          to   { opacity:1; transform:none; }
        }
        @keyframes typing {
          0%,100% { opacity:0.25; transform:translateY(0); }
          50%      { opacity:1;    transform:translateY(-3px); }
        }
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(24px); }
          to   { opacity:1; transform:none; }
        }
        .fade-up { animation: fadeUp 600ms ease-out both; }
        .fade-up-2 { animation: fadeUp 600ms 150ms ease-out both; }
        .fade-up-3 { animation: fadeUp 600ms 300ms ease-out both; }
        a { text-decoration:none; }
        button { font-family:inherit; }
        * { box-sizing:border-box; }
      `}</style>

      {/* ── NAV ── */}
      <header style={{
        position:'sticky', top:0, zIndex:50,
        backdropFilter:'blur(20px)',
        background:'rgba(10,11,15,0.82)',
      }}>
        <div style={{ maxWidth:1160, margin:'0 auto', padding:'0 24px', height:56, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <Logo />
          <nav style={{ display:'flex', alignItems:'center', gap:24, fontSize:13.5 }}>
            {[['#how', 'How it works'], ['#features', 'Features']].map(([href, label]) => (
              <a key={href} href={href} style={{ color:'rgba(255,255,255,0.45)', transition:'color 150ms' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}>
                {label}
              </a>
            ))}
            <Link to="/login" style={{ color:'rgba(255,255,255,0.55)', fontWeight:500, transition:'color 150ms' }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}>
              Sign in
            </Link>
            <Link to="/signup" style={{
              display:'inline-flex', alignItems:'center', gap:6,
              height:34, padding:'0 16px', borderRadius:10,
              background:'linear-gradient(135deg,#34d399,#059669)',
              color:'#fff', fontSize:13.5, fontWeight:600,
              boxShadow:'0 4px 14px rgba(52,211,153,0.3)',
              transition:'opacity 150ms',
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.opacity = '1')}>
              Get started <ChevronRight size={14} />
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ── HERO ── */}
        <section style={{ padding:'80px 24px 60px', position:'relative', overflow:'hidden' }}>
          {/* ambient blobs */}
          <div style={{ position:'absolute', top:-120, left:'50%', transform:'translateX(-50%)', width:800, height:500, borderRadius:'50%', background:'radial-gradient(ellipse, rgba(52,211,153,0.12) 0%, transparent 65%)', pointerEvents:'none' }} />
          <div style={{ position:'absolute', top:100, left:-200, width:400, height:400, borderRadius:'50%', background:'radial-gradient(ellipse, rgba(99,102,241,0.08) 0%, transparent 70%)', pointerEvents:'none' }} />

          <div style={{ maxWidth:1160, margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:64, alignItems:'center' }}>

            {/* Left */}
            <div className="fade-up">
              <div style={{
                display:'inline-flex', alignItems:'center', gap:8,
                borderRadius:24, padding:'6px 14px',
                background:'rgba(52,211,153,0.1)',
                border:'1px solid rgba(52,211,153,0.25)',
                fontSize:12.5, fontWeight:600, color:'#34d399',
                marginBottom:24,
              }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:'#34d399', boxShadow:'0 0 8px rgba(52,211,153,0.7)', display:'inline-block' }} />
                WhatsApp Loyalty · No app required
              </div>

              <h1 style={{ fontSize:48, fontWeight:800, lineHeight:1.05, letterSpacing:'-0.03em', margin:0 }}>
                <span style={{ color:'#fff' }}>Turn every chat into</span><br />
                <span style={{ background:'linear-gradient(135deg,#34d399 0%,#6ee7b7 60%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                  loyalty that lasts.
                </span>
              </h1>

              <p style={{ marginTop:20, fontSize:16.5, lineHeight:1.7, color:'rgba(255,255,255,0.5)', maxWidth:'42ch' }}>
                Run earn, redeem, tiers, referrals and campaigns entirely inside WhatsApp. Customers just message — no app, no portal.
              </p>

              <div style={{ marginTop:32, display:'flex', gap:12, flexWrap:'wrap' }}>
                <Link to="/signup" style={{
                  display:'inline-flex', alignItems:'center', gap:8,
                  height:44, padding:'0 24px', borderRadius:12,
                  background:'linear-gradient(135deg,#34d399,#059669)',
                  color:'#fff', fontSize:14.5, fontWeight:700,
                  boxShadow:'0 8px 24px rgba(52,211,153,0.3)',
                  transition:'transform 150ms, box-shadow 150ms',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 12px 28px rgba(52,211,153,0.4)'; }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 8px 24px rgba(52,211,153,0.3)'; }}>
                  Start free trial <ArrowRight size={16} />
                </Link>
                <Link to="/login?demo=1" style={{
                  display:'inline-flex', alignItems:'center', gap:8,
                  height:44, padding:'0 24px', borderRadius:12,
                  background:'rgba(255,255,255,0.05)',
                  border:'1.5px solid rgba(255,255,255,0.12)',
                  color:'rgba(255,255,255,0.75)', fontSize:14.5, fontWeight:600,
                  transition:'background 150ms, color 150ms',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.background='rgba(255,255,255,0.1)'; e.currentTarget.style.color='#fff'; }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.background='rgba(255,255,255,0.05)'; e.currentTarget.style.color='rgba(255,255,255,0.75)'; }}>
                  See live demo
                </Link>
              </div>

              {/* trust */}
              <div style={{ marginTop:28, display:'flex', gap:20, flexWrap:'wrap' }}>
                {['No credit card', '14-day free trial', 'SOC 2 compliant'].map(t => (
                  <span key={t} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, color:'rgba(255,255,255,0.3)' }}>
                    <Check size={13} color="#34d399" strokeWidth={2.5} /> {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Right — phone */}
            <div className="fade-up-2" style={{ display:'flex', justifyContent:'center' }}>
              <PhoneDemo />
            </div>
          </div>
        </section>

        {/* ── STATS ── */}
        <section style={{ padding:'48px 24px', background:'rgba(255,255,255,0.018)' }}>
          <div style={{ maxWidth:1160, margin:'0 auto', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:32, textAlign:'center' }}>
            {STATS.map(({ value, label }) => (
              <div key={label}>
                <div style={{ fontSize:42, fontWeight:800, letterSpacing:'-0.04em', background:'linear-gradient(135deg,#34d399,#6ee7b7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', fontVariantNumeric:'tabular-nums' }}>
                  {value}
                </div>
                <div style={{ marginTop:6, fontSize:13, color:'rgba(255,255,255,0.38)', lineHeight:1.4 }}>{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how" style={{ padding:'80px 24px' }}>
          <div style={{ maxWidth:1160, margin:'0 auto' }}>
            <div style={{ textAlign:'center', marginBottom:56 }}>
              <p style={{ fontSize:12, fontWeight:700, letterSpacing:'0.12em', color:'#34d399', textTransform:'uppercase', marginBottom:12 }}>How it works</p>
              <h2 style={{ fontSize:34, fontWeight:800, letterSpacing:'-0.025em', color:'#fff', margin:0 }}>Loyalty on autopilot, in four steps</h2>
              <p style={{ marginTop:12, fontSize:15.5, color:'rgba(255,255,255,0.4)', maxWidth:'50ch', margin:'12px auto 0' }}>Every message triggers an instant decision. No manual work, no delays.</p>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:2, position:'relative' }}>
              {/* connector line */}
              <div style={{ position:'absolute', top:36, left:'12.5%', right:'12.5%', height:1, background:'linear-gradient(90deg, transparent, rgba(52,211,153,0.3) 20%, rgba(52,211,153,0.3) 80%, transparent)', pointerEvents:'none' }} />

              {[
                { icon: MessageCircle, label: 'Customer messages', desc: 'A purchase confirmation, "check my points", or a referral code arrives on WhatsApp.' },
                { icon: Bot, label: 'Engine activates', desc: 'The workflow matches a trigger and executes in milliseconds with no manual input.' },
                { icon: Star, label: 'Reward issued', desc: 'A coupon, cashback code or tier badge is delivered as a WhatsApp reply under 1 second.' },
                { icon: BarChart3, label: 'Analytics logs it', desc: 'Every action updates the live dashboard — redemption rates, tier moves, revenue lift.' },
              ].map(({ icon: Icon, label, desc }, i) => (
                <div key={label} style={{ padding:'0 20px', textAlign:'center' }}>
                  <div style={{ position:'relative', display:'inline-flex', marginBottom:20 }}>
                    <div style={{
                      width:60, height:60, borderRadius:18,
                      background:'rgba(52,211,153,0.08)',
                      border:'1.5px solid rgba(52,211,153,0.2)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      boxShadow:'0 8px 20px rgba(52,211,153,0.1)',
                    }}>
                      <Icon size={24} color="#34d399" strokeWidth={1.5} />
                    </div>
                    <span style={{
                      position:'absolute', top:-6, right:-6,
                      width:22, height:22, borderRadius:'50%',
                      background:'linear-gradient(135deg,#34d399,#059669)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:11, fontWeight:800, color:'#fff',
                    }}>{i + 1}</span>
                  </div>
                  <div style={{ fontSize:14.5, fontWeight:700, color:'#fff', marginBottom:8 }}>{label}</div>
                  <div style={{ fontSize:13, color:'rgba(255,255,255,0.38)', lineHeight:1.6 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section id="features" style={{ padding:'0 24px 80px' }}>
          <div style={{ maxWidth:1160, margin:'0 auto' }}>
            <div style={{ textAlign:'center', margin:'64px 0 48px' }}>
              <p style={{ fontSize:12, fontWeight:700, letterSpacing:'0.12em', color:'#34d399', textTransform:'uppercase', marginBottom:12 }}>Features</p>
              <h2 style={{ fontSize:34, fontWeight:800, letterSpacing:'-0.025em', color:'#fff', margin:0 }}>Everything loyalty needs</h2>
              <p style={{ marginTop:12, fontSize:15.5, color:'rgba(255,255,255,0.4)', maxWidth:'48ch', margin:'12px auto 0' }}>Click any feature to explore it.</p>
            </div>
            <FeatureGrid />
          </div>
        </section>

        {/* ── SETUP ── */}
        <section style={{ padding:'80px 24px', background:'rgba(255,255,255,0.018)' }}>
          <div style={{ maxWidth:1160, margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1.1fr', gap:80, alignItems:'start' }}>
            <div>
              <p style={{ fontSize:12, fontWeight:700, letterSpacing:'0.12em', color:'#34d399', textTransform:'uppercase', marginBottom:16 }}>Setup</p>
              <h2 style={{ fontSize:34, fontWeight:800, letterSpacing:'-0.025em', color:'#fff', margin:'0 0 16px' }}>Live in three steps</h2>
              <p style={{ fontSize:15.5, color:'rgba(255,255,255,0.4)', lineHeight:1.7, margin:0 }}>
                Test your entire loyalty flow against the built-in simulator. Connect your number when you are ready.
              </p>
            </div>
            <ol style={{ listStyle:'none', margin:0, padding:0, display:'flex', flexDirection:'column', gap:20 }}>
              {[
                { t: 'Configure your points rules', d: 'Set earn rates per spend, bonus triggers — referrals, birthdays, reviews — and daily caps. No code.' },
                { t: 'Build your rewards catalogue', d: 'Add discount coupons, free products, exclusive access or cashback. Each reward has a configurable point cost.' },
                { t: 'Connect your WhatsApp number', d: 'Link your Meta Business number in minutes. Customers enrol automatically on their next message.' },
              ].map(({ t, d }, i) => (
                <li key={t} style={{ display:'flex', gap:18 }}>
                  <span style={{
                    width:34, height:34, borderRadius:'50%', flexShrink:0,
                    background:'rgba(52,211,153,0.1)',
                    border:'1.5px solid rgba(52,211,153,0.3)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:13.5, fontWeight:800, color:'#34d399',
                  }}>{i + 1}</span>
                  <div style={{ paddingTop:6 }}>
                    <p style={{ fontSize:14.5, fontWeight:700, color:'#fff', margin:'0 0 6px' }}>{t}</p>
                    <p style={{ fontSize:13.5, color:'rgba(255,255,255,0.4)', lineHeight:1.6, margin:0 }}>{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── CTA ── */}
        <section style={{ padding:'80px 24px' }}>
          <div style={{ maxWidth:700, margin:'0 auto', textAlign:'center', position:'relative' }}>
            <div style={{ position:'absolute', inset:'-60px', borderRadius:'50%', background:'radial-gradient(ellipse, rgba(52,211,153,0.12) 0%, transparent 65%)', pointerEvents:'none' }} />
            <div style={{ position:'relative', padding:'56px 48px', borderRadius:24, border:'1.5px solid rgba(52,211,153,0.2)', background:'rgba(52,211,153,0.04)' }}>
              <div style={{ width:52, height:52, borderRadius:16, background:'rgba(52,211,153,0.12)', border:'1.5px solid rgba(52,211,153,0.25)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 24px' }}>
                <MessageCircle size={24} color="#34d399" strokeWidth={1.5} />
              </div>
              <h2 style={{ fontSize:32, fontWeight:800, letterSpacing:'-0.025em', color:'#fff', margin:'0 0 16px' }}>
                Ready to reward on WhatsApp?
              </h2>
              <p style={{ fontSize:15.5, color:'rgba(255,255,255,0.45)', lineHeight:1.7, maxWidth:'42ch', margin:'0 auto 32px' }}>
                Join brands running loyalty programmes customers actually use — because it is just a WhatsApp message away.
              </p>
              <div style={{ display:'flex', justifyContent:'center', gap:12, flexWrap:'wrap' }}>
                <Link to="/signup" style={{
                  display:'inline-flex', alignItems:'center', gap:8,
                  height:44, padding:'0 28px', borderRadius:12,
                  background:'linear-gradient(135deg,#34d399,#059669)',
                  color:'#fff', fontSize:14.5, fontWeight:700,
                  boxShadow:'0 8px 24px rgba(52,211,153,0.3)',
                  transition:'transform 150ms',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.transform='translateY(-2px)')}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.transform='none')}>
                  Start free trial <ArrowRight size={16} />
                </Link>
                <Link to="/login?demo=1" style={{
                  display:'inline-flex', alignItems:'center', height:44, padding:'0 28px', borderRadius:12,
                  background:'rgba(255,255,255,0.05)', border:'1.5px solid rgba(255,255,255,0.12)',
                  color:'rgba(255,255,255,0.7)', fontSize:14.5, fontWeight:600,
                  transition:'background 150ms',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.background='rgba(255,255,255,0.1)')}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.background='rgba(255,255,255,0.05)')}>
                  See live demo
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ── */}
      <footer style={{ padding:'28px 24px' }}>
        <div style={{ maxWidth:1160, margin:'0 auto', display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', gap:16, fontSize:12.5, color:'rgba(255,255,255,0.22)' }}>
          <span style={{ display:'flex', alignItems:'center', gap:8 }}>
            <LogoMark className="size-4" /> Threadline · WhatsApp Loyalty Platform
          </span>
          <span>Uses the official WhatsApp Business Platform. WhatsApp is a trademark of its owner.</span>
          <span style={{ display:'flex', gap:20 }}>
            <Link to="/docs" style={{ color:'rgba(255,255,255,0.22)', transition:'color 150ms' }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color='rgba(255,255,255,0.6)')}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color='rgba(255,255,255,0.22)')}>
              Documentation
            </Link>
            <Link to="/login" style={{ color:'rgba(255,255,255,0.22)', transition:'color 150ms' }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color='rgba(255,255,255,0.6)')}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color='rgba(255,255,255,0.22)')}>
              Sign in
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
