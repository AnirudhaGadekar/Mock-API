import { Check, Zap, Users, Database, Crown, Star, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";

const plans = [
  {
    id: "free",
    name: "Free",
    description: "Perfect for individuals and small projects",
    price: "$0",
    period: "forever",
    icon: Star,
    features: [
      "5 mock endpoints",
      "1,000 requests/month",
      "Basic request logging (7 days)",
      "AI-powered Basic features",
      "Core mocking features",
      "OpenAPI import",
      "Advanced chaos engineering",
    ],
    limitations: [
      "No team collaboration",
      "No tunneling",
      "No SAML/SSO",
    ],
    highlighted: false,
    buttonText: "Get Started",
    buttonVariant: "outline" as const,
  },
  {
    id: "pro",
    name: "Pro",
    description: "For professional developers and growing teams",
    price: "$19",
    period: "per month",
    icon: Zap,
    features: [
      "Everything in Free",
      "50 mock endpoints",
      "100,000 requests/month",
      "Advanced request logging (30 days)",
      "Team collaboration (5 members)",
      "AI-powered rule generation",
      "Local tunneling (CLI)",
      "Advanced chaos engineering",
      "Stateful mocking",
      "GraphQL & SOAP support",
      "Priority email support",
      "Custom domains",
    ],
    limitations: [
      "No SAML/SSO",
      "No enterprise features",
    ],
    highlighted: true,
    buttonText: "Start Free Trial",
    buttonVariant: "default" as const,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For large organizations with advanced needs",
    price: "Custom",
    period: "contact us",
    icon: Crown,
    features: [
      "Everything in Pro",
      "Unlimited mock endpoints",
      "Unlimited requests",
      "Unlimited team members",
      "SAML/SSO integration",
      "Service API keys with scopes",
      "Audit logs & compliance",
      "Dedicated support",
      "Custom SLA",
      "On-premise deployment option",
      "Advanced analytics",
      "Data export/import",
    ],
    limitations: [],
    highlighted: false,
    buttonText: "Contact Sales",
    buttonVariant: "outline" as const,
  },
];

const faqs = [
  {
    question: "What counts as a request?",
    answer: "Every HTTP request to your mock endpoints counts, including successful requests, errors, and timeouts. Requests to the MockAPI dashboard and API documentation are not counted.",
  },
  {
    question: "Can I change plans anytime?",
    answer: "Yes! You can upgrade or downgrade your plan at any time. When upgrading, you'll be charged a prorated amount for the remainder of the billing period. When downgrading, the change takes effect at the next billing cycle.",
  },
  {
    question: "What happens if I exceed my limits?",
    answer: "Free plans are rate-limited when limits are reached. Pro plans get soft limits with overage charges at $0.10 per 1,000 additional requests. Enterprise plans have custom limits based on your needs.",
  },
  {
    question: "Do you offer discounts?",
    answer: "Yes! We offer 50% off for students, educators, and open-source projects. Annual billing also saves you 20% compared to monthly billing.",
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept all major credit cards, PayPal, and wire transfers for Enterprise plans. All payments are processed securely through Stripe.",
  },
  {
    question: "Is my data secure?",
    answer: "Absolutely. We use industry-standard encryption (TLS 1.3) for data in transit, AES-256 encryption for data at rest, and maintain SOC 2 Type II compliance for Enterprise customers.",
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes, you can cancel your subscription at any time. Your service will continue until the end of your current billing period, and you won't be charged again.",
  },
];

export default function Pricing() {
  const { theme, toggleTheme } = useTheme();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Pricing - MockAPI";
  }, []);

  const handlePlanSelect = (planId: string) => {
    if (planId === 'enterprise') {
      window.location.href = 'mailto:sales@mockapi.online?subject=Enterprise%20Plan%20Inquiry';
    } else {
      // TODO: Implement signup flow with plan selection
      console.log('Selected plan:', planId);
    }
  };

  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  const getAnnualPrice = (monthlyPrice: string) => {
    const price = parseInt(monthlyPrice.replace('$', ''));
    return `$${Math.round(price * 12 * 0.8)}`;
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--secondary)/0.28)_100%)] text-foreground">
      <nav className="sticky top-0 z-20 border-b border-border/70 bg-background/78 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <a
            href="https://www.mockapi.online"
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
          >
            <Database className="h-4 w-4 text-primary" />
            MockAPI
          </a>
          <div className="flex items-center gap-4">
            <a
              href="https://www.mockapi.online/privacy"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Privacy Policy
            </a>
            <a
              href="https://www.mockapi.online/terms"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Terms of Service
            </a>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/70 text-muted-foreground transition-colors hover:text-foreground"
            >
              {theme === "dark" ? <Star className="h-4 w-4" /> : <Star className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </nav>

      <header className="border-b border-border/70 bg-card/60 px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Crown className="h-3.5 w-3.5" />
            Pricing Plans
          </div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
            Simple, transparent pricing for every team size
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Start free, scale as you grow. No hidden fees, no surprises.
          </p>
          
          {/* Billing Toggle */}
          <div className="mt-8 inline-flex items-center rounded-full border border-border/70 bg-card/80 p-1">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                billingCycle === 'monthly'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                billingCycle === 'annual'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Annual <span className="ml-1 rounded bg-primary/20 px-1.5 py-0.5 text-xs">Save 20%</span>
            </button>
          </div>
        </div>
      </header>

      {/* Pricing Cards */}
      <section className="px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-3">
            {plans.map((plan) => {
              const Icon = plan.icon;
              const displayPrice = billingCycle === 'annual' && plan.price !== '$0' && plan.price !== 'Custom'
                ? getAnnualPrice(plan.price)
                : plan.price;
              
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-[1.5rem] border p-8 shadow-floating backdrop-blur transition-all duration-300 hover:shadow-lg ${
                    plan.highlighted
                      ? 'border-primary/50 bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border/70 bg-card/95'
                  }`}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full border border-primary/20 bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                      Most Popular
                    </div>
                  )}
                  
                  <div className="mb-6">
                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="text-2xl font-semibold">{plan.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
                  </div>
                  
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">{displayPrice}</span>
                      {plan.period !== 'forever' && (
                        <span className="text-sm text-muted-foreground">/{plan.period}</span>
                      )}
                    </div>
                  </div>

                  <div className="mb-8">
                    <ul className="space-y-3">
                      {plan.features.map((feature, index) => (
                        <li key={index} className="flex items-start gap-3">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                          <span className="text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    
                    {plan.limitations.length > 0 && (
                      <div className="mt-6 rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950">
                        <h4 className="mb-2 text-sm font-semibold text-orange-800 dark:text-orange-200">Limitations:</h4>
                        <ul className="space-y-2">
                          {plan.limitations.map((limitation, index) => (
                            <li key={index} className="flex items-start gap-2 text-xs text-orange-700 dark:text-orange-300">
                              <span className="mt-0.5 h-3 w-3 shrink-0">•</span>
                              <span>{limitation}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handlePlanSelect(plan.id)}
                    className={`w-full rounded-xl px-6 py-3 font-semibold transition-colors ${
                      plan.highlighted
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : plan.buttonVariant === 'outline'
                        ? 'border border-border bg-background hover:bg-secondary'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    }`}
                  >
                    {plan.buttonText}
                    {plan.id === 'enterprise' && (
                      <ArrowRight className="ml-2 inline h-4 w-4" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Feature Comparison */}
      <section className="border-b border-border/70 bg-card/40 px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Compare all features</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Detailed breakdown of what's included in each plan
            </p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] rounded-xl border border-border/70 bg-card/95">
              <thead>
                <tr className="border-b border-border/70">
                  <th className="px-6 py-4 text-left text-sm font-semibold">Feature</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold">Free</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold">Pro</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 text-sm font-medium">Mock Endpoints</td>
                  <td className="px-6 py-4 text-center text-sm">5</td>
                  <td className="px-6 py-4 text-center text-sm">50</td>
                  <td className="px-6 py-4 text-center text-sm font-semibold text-primary">Unlimited</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 text-sm font-medium">Monthly Requests</td>
                  <td className="px-6 py-4 text-center text-sm">1,000</td>
                  <td className="px-6 py-4 text-center text-sm">100,000</td>
                  <td className="px-6 py-4 text-center text-sm font-semibold text-primary">Unlimited</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 text-sm font-medium">Request Log Retention</td>
                  <td className="px-6 py-4 text-center text-sm">7 days</td>
                  <td className="px-6 py-4 text-center text-sm">30 days</td>
                  <td className="px-6 py-4 text-center text-sm font-semibold text-primary">Unlimited</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 text-sm font-medium">Team Members</td>
                  <td className="px-6 py-4 text-center text-sm">1</td>
                  <td className="px-6 py-4 text-center text-sm">5</td>
                  <td className="px-6 py-4 text-center text-sm font-semibold text-primary">Unlimited</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 text-sm font-medium">AI Rule Generation</td>
                  <td className="px-6 py-4 text-center text-sm">
                    <span className="text-red-500">✗</span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm">
                    <span className="text-green-500">✓</span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm font-semibold text-primary">
                    <span className="text-green-500">✓</span>
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 text-sm font-medium">Local Tunneling</td>
                  <td className="px-6 py-4 text-center text-sm">
                    <span className="text-red-500">✗</span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm">
                    <span className="text-green-500">✓</span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm font-semibold text-primary">
                    <span className="text-green-500">✓</span>
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 text-sm font-medium">SAML/SSO</td>
                  <td className="px-6 py-4 text-center text-sm">
                    <span className="text-red-500">✗</span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm">
                    <span className="text-red-500">✗</span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm font-semibold text-primary">
                    <span className="text-green-500">✓</span>
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 text-sm font-medium">Priority Support</td>
                  <td className="px-6 py-4 text-center text-sm">Community</td>
                  <td className="px-6 py-4 text-center text-sm">Email</td>
                  <td className="px-6 py-4 text-center text-sm font-semibold text-primary">Dedicated</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Frequently asked questions</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Got questions? We've got answers.
            </p>
          </div>
          
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div key={index} className="rounded-xl border border-border/70 bg-card/95">
                <button
                  onClick={() => toggleFaq(index)}
                  className="w-full px-6 py-4 text-left transition-colors hover:bg-secondary/50"
                >
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-base font-semibold">{faq.question}</h3>
                    <div className={`h-5 w-5 shrink-0 transition-transform ${
                      expandedFaq === index ? 'rotate-180' : ''
                    }`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m6 9 6 6 6 6-6"/>
                      </svg>
                    </div>
                  </div>
                </button>
                
                {expandedFaq === index && (
                  <div className="px-6 pb-4">
                    <p className="text-sm text-muted-foreground leading-6">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-border/70 bg-card/60 px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Users className="h-3.5 w-3.5" />
            Ready to get started?
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Join thousands of developers using MockAPI
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Start for free, upgrade when you need more power.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => handlePlanSelect('free')}
              className="rounded-xl border border-border bg-background px-8 py-3 font-semibold transition-colors hover:bg-secondary"
            >
              Start Free Trial
            </button>
            <button
              onClick={() => handlePlanSelect('enterprise')}
              className="rounded-xl bg-primary px-8 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Contact Sales
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/70 bg-card/60 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-3 flex flex-wrap items-center justify-center gap-5 text-sm text-muted-foreground">
            <a href="https://www.mockapi.online" className="transition-colors hover:text-foreground">
              Home
            </a>
            <a href="https://www.mockapi.online/privacy" className="transition-colors hover:text-foreground">
              Privacy Policy
            </a>
            <a href="https://www.mockapi.online/terms" className="transition-colors hover:text-foreground">
              Terms of Service
            </a>
            <a href="https://www.mockapi.online/pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
          </div>
          <p className="text-xs text-muted-foreground">Copyright 2026 MockAPI. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
