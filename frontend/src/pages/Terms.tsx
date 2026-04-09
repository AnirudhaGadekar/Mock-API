import { CalendarDays, Clock3, FileText, Mail, Moon, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";

const CONTACT_EMAIL = "mockurlteam@gmail.com";

const tocItems = [
  { id: "acceptance", number: "1", title: "Acceptance" },
  { id: "description", number: "2", title: "Description of Service" },
  { id: "accounts", number: "3", title: "Your Account" },
  { id: "acceptable-use", number: "4", title: "Acceptable Use" },
  { id: "api-usage", number: "5", title: "API Usage & Fair Use" },
  { id: "intellectual-property", number: "6", title: "Intellectual Property" },
  { id: "privacy", number: "7", title: "Privacy & Data" },
  { id: "disclaimers", number: "8", title: "Disclaimers" },
  { id: "liability", number: "9", title: "Limitation of Liability" },
  { id: "termination", number: "10", title: "Termination" },
  { id: "changes", number: "11", title: "Changes to Terms" },
  { id: "contact", number: "12", title: "Contact" },
] as const;

function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-b border-border/70 pb-10 last:border-b-0 last:pb-0">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-xs font-semibold text-primary">
          {number}
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        </div>
      </div>
      <div className="space-y-4 text-[15px] leading-7 text-muted-foreground sm:text-base">
        {children}
      </div>
    </section>
  );
}

export default function Terms() {
  const { theme, toggleTheme } = useTheme();
  const [activeSection, setActiveSection] = useState<string>(tocItems[0].id);

  useEffect(() => {
    document.title = "Terms of Service - MockAPI";
  }, []);

  useEffect(() => {
    const sections = tocItems
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => Boolean(section));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target?.id) {
          setActiveSection(visible.target.id);
        }
      },
      {
        rootMargin: "-18% 0px -60% 0px",
        threshold: [0.1, 0.25, 0.5],
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--secondary)/0.28)_100%)] text-foreground">
      <nav className="sticky top-0 z-20 border-b border-border/70 bg-background/78 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <a
            href="https://www.mockapi.online"
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
          >
            <Search className="h-4 w-4 text-primary" />
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
              href="https://www.mockapi.online"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Home
            </a>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/70 text-muted-foreground transition-colors hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </nav>

      <header className="border-b border-border/70 bg-card/60 px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <FileText className="h-3.5 w-3.5" />
            Legal
          </div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">Terms of Service</h1>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Effective: April 10, 2026
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Last updated: April 10, 2026
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav className="rounded-[1.5rem] border border-border/70 bg-card/80 p-4 shadow-card backdrop-blur">
            <div className="mb-3 border-b border-border/70 pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Contents
            </div>
            <ol className="space-y-1">
              {tocItems.map((item) => {
                const isActive = activeSection === item.id;
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                      }`}
                    >
                      <span className="w-5 shrink-0 text-xs font-semibold opacity-70">{item.number}</span>
                      <span>{item.title}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        <div className="space-y-10">
          <div className="rounded-[1.5rem] border border-primary/25 bg-primary/10 px-5 py-4 text-sm leading-6 text-foreground shadow-soft">
            By using MockAPI, you agree to these terms. Please read them carefully. If you disagree
            with any part, you may not use our service.
          </div>

          <div className="space-y-10 rounded-[2rem] border border-border/70 bg-card/92 p-6 shadow-floating backdrop-blur sm:p-8 lg:p-10">
            <Section id="acceptance" number="1" title="Acceptance of Terms">
              <p>
                These Terms of Service ("Terms") govern your access to and use of MockAPI ("the
                Service"), operated by MockAPI ("we," "our," or "us"), accessible at{" "}
                <strong className="text-foreground">www.mockapi.online</strong>.
              </p>
              <p>
                By creating an account, accessing, or using the Service in any way, you confirm
                that you are at least 13 years of age, have read and understood these Terms, and
                agree to be bound by them. If you are using the Service on behalf of an
                organization, you represent that you have the authority to bind that organization
                to these Terms.
              </p>
            </Section>

            <Section id="description" number="2" title="Description of Service">
              <p>MockAPI is a cloud-based API mocking and testing platform that allows developers to:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Create mock REST API endpoints with configurable responses</li>
                <li>Simulate delays, errors, and fault injection for testing purposes</li>
                <li>Expose local development servers via tunneling</li>
                <li>Collaborate with team members through shared workspaces</li>
                <li>Generate realistic mock data using AI-powered tools</li>
                <li>Import and mock APIs from OpenAPI/Swagger specifications</li>
              </ul>
              <p>
                We reserve the right to modify, suspend, or discontinue any part of the Service at
                any time with reasonable notice.
              </p>
            </Section>

            <Section id="accounts" number="3" title="Your Account">
              <p>
                To access certain features, you must register for an account using a valid email
                address or supported OAuth provider (Google, GitHub). You are responsible for:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Maintaining the confidentiality of your account credentials and API keys</li>
                <li>All activity that occurs under your account</li>
                <li>
                  Notifying us immediately at{" "}
                  <a
                    className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                    href={`mailto:${CONTACT_EMAIL}`}
                  >
                    {CONTACT_EMAIL}
                  </a>{" "}
                  of any unauthorized use
                </li>
                <li>Providing accurate and up-to-date account information</li>
              </ul>
              <p>
                You may not share your account with others or create multiple free accounts to
                circumvent service limits.
              </p>
            </Section>

            <Section id="acceptable-use" number="4" title="Acceptable Use">
              <p>You agree to use the Service only for lawful purposes. You must not use MockAPI to:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Violate any applicable local, national, or international law or regulation</li>
                <li>Send unsolicited messages, spam, or conduct phishing attacks</li>
                <li>Distribute malware, viruses, or any malicious code through mock endpoints</li>
                <li>Attempt to gain unauthorized access to other users' data or our infrastructure</li>
                <li>Conduct load testing or DDoS simulations targeting third-party systems</li>
                <li>Scrape, crawl, or harvest data from the Service without our prior written consent</li>
                <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
                <li>Resell or sublicense access to the Service without written authorization</li>
              </ul>
              <p>
                We reserve the right to suspend or terminate accounts that violate these policies
                without prior notice.
              </p>
            </Section>

            <Section id="api-usage" number="5" title="API Usage & Fair Use">
              <p>
                MockAPI may enforce operational limits on endpoints, request volume, retention
                windows, collaboration features, and other shared resources in order to protect
                service reliability and availability.
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong className="text-foreground">Fair use:</strong> Usage that degrades
                  service quality for other users may be throttled
                </li>
                <li>
                  <strong className="text-foreground">Operational limits:</strong> Requests that
                  exceed system limits may be rate-limited, queued, or rejected
                </li>
                <li>
                  <strong className="text-foreground">Abuse:</strong> Automated abuse or attempts
                  to circumvent limits will result in account suspension
                </li>
              </ul>
            </Section>

            <Section id="intellectual-property" number="6" title="Intellectual Property">
              <p>
                <strong className="text-foreground">Our IP:</strong> The MockAPI platform,
                including its design, code, branding, and documentation, is owned by us and
                protected by copyright, trademark, and other intellectual property laws. You may
                not copy, modify, or distribute our software without written permission.
              </p>
              <p>
                <strong className="text-foreground">Your content:</strong> You retain full
                ownership of any data, configurations, schemas, and mock responses you create
                within the Service. By using MockAPI, you grant us a limited, non-exclusive license
                to store and process your content solely to provide the Service to you.
              </p>
              <p>We do not claim ownership over your data and will never sell it to third parties.</p>
            </Section>

            <Section id="privacy" number="7" title="Privacy & Data">
              <p>
                Your privacy is important to us. Our collection and use of personal information is
                governed by our{" "}
                <a
                  className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                  href="https://www.mockapi.online/privacy"
                >
                  Privacy Policy
                </a>
                , which is incorporated into these Terms by reference.
              </p>
              <p>Specifically regarding your mock data:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Request logs are retained according to our operational retention settings</li>
                <li>You can remove data where the product exposes those controls</li>
                <li>Account deactivation ends access, but certain records may be retained for legal, security, and operational review</li>
                <li>We use industry-standard encryption for data in transit (TLS) and at rest</li>
              </ul>
            </Section>

            <Section id="disclaimers" number="8" title="Disclaimers">
              <p>
                The Service is provided on an <strong className="text-foreground">"as is" and "as available"</strong>{" "}
                basis without warranties of any kind, either express or implied, including but not
                limited to warranties of merchantability, fitness for a particular purpose, or
                non-infringement.
              </p>
              <p>We do not warrant that:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>The Service will be uninterrupted, error-free, or completely secure</li>
                <li>Any defects or errors will be corrected</li>
                <li>The Service is free of viruses or other harmful components</li>
                <li>Results obtained from using the Service will be accurate or reliable</li>
              </ul>
              <p>
                MockAPI is a developer tool intended for testing and development. It should not be
                used as a production backend for critical applications.
              </p>
            </Section>

            <Section id="liability" number="9" title="Limitation of Liability">
              <p>
                To the maximum extent permitted by applicable law, MockAPI and its operators shall
                not be liable for any indirect, incidental, special, consequential, or punitive
                damages, including but not limited to:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Loss of profits, data, or business opportunities</li>
                <li>Service interruptions or downtime</li>
                <li>Unauthorized access to or alteration of your data</li>
                <li>Costs of procuring substitute services</li>
              </ul>
              <p>
                Our total cumulative liability for any claims arising out of or relating to these
                Terms or the Service shall not exceed the amount you paid us in the 12 months
                preceding the claim, or <strong className="text-foreground">USD $100</strong>,
                whichever is greater.
              </p>
            </Section>

            <Section id="termination" number="10" title="Termination">
              <p>
                <strong className="text-foreground">By you:</strong> You may stop using the Service
                and deactivate your account at any time through the account settings page. While deactivation
                is immediate and irreversible for your access, we may retain certain account data 
                as required for legal compliance and performance review purposes.
              </p>
              <p>
                <strong className="text-foreground">By us:</strong> We reserve the right to suspend
                or terminate your account, with or without notice, if we reasonably believe you
                have violated these Terms, engaged in fraudulent activity, or posed a security risk
                to the Service or other users.
              </p>
              <p>
                Upon termination, your right to use the Service immediately ceases. Provisions of
                these Terms that by their nature should survive termination shall survive,
                including ownership, disclaimers, and limitations of liability.
              </p>
            </Section>

            <Section id="changes" number="11" title="Changes to These Terms">
              <p>
                We may update these Terms from time to time. When we do, we will post the updated
                version on this page and update the "Last updated" date at the top.
              </p>
              <p>
                Your continued use of the Service after changes become effective constitutes your
                acceptance of the updated Terms. If you do not agree to the new Terms, you must
                stop using the Service.
              </p>
            </Section>

            <Section id="contact" number="12" title="Contact Us">
              <p>
                If you have any questions, concerns, or complaints about these Terms or the
                Service, please reach out. We will try to respond promptly.
              </p>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="mt-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Mail className="h-4 w-4" />
                {CONTACT_EMAIL}
              </a>
            </Section>
          </div>
        </div>
      </div>

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
          </div>
          <p className="text-xs text-muted-foreground">Copyright 2026 MockAPI. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
