import { useEffect } from "react";

const sections = {
  informationWeCollect: [
    {
      title: "Account information:",
      body: "name, email address, and profile picture when you sign up via Google, GitHub, or email.",
    },
    {
      title: "Usage data:",
      body: "API endpoints you create, mock rules, tunnel sessions, and request logs, which may include request paths, query parameters, headers, bodies, IP addresses, and user agents.",
    },
    {
      title: "Technical data:",
      body: "IP address, browser type, device type, and access timestamps.",
    },
    {
      title: "Communications:",
      body: "messages you send us via email or support channels.",
    },
  ],
  howWeUse: [
    "To provide, maintain, and improve MockAPI services.",
    "To authenticate you and keep your account secure.",
    "To send account-related emails such as OTP codes, invitations, and security messages.",
    "To monitor service health, debug issues, and prevent abuse.",
    "To enforce our Terms of Service.",
  ],
  thirdPartyServices: [
    {
      title: "Google OAuth",
      body: "for sign-in",
      href: "https://policies.google.com/privacy",
      linkLabel: "Google Privacy Policy",
    },
    {
      title: "GitHub OAuth",
      body: "for sign-in",
      href: "https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement",
      linkLabel: "GitHub Privacy Statement",
    },
    {
      title: "Resend",
      body: "for transactional email delivery such as OTP and verification emails",
      href: "https://resend.com/legal/privacy-policy",
      linkLabel: "Resend Privacy Policy",
    },
    {
      title: "Vercel",
      body: "for frontend hosting and analytics",
      href: "https://vercel.com/legal/privacy-policy",
      linkLabel: "Vercel Privacy Policy",
    },
    {
      title: "Render",
      body: "for backend hosting and deployment",
      href: "https://render.com/privacy",
      linkLabel: "Render Privacy Policy",
    },
  ],
  yourRights: [
    "Access the personal data we hold about you.",
    "Correct inaccurate data.",
    "Deactivate your account and request deletion of removable data, subject to legal and compliance retention obligations.",
    "Request export of your data in a portable format by contacting us.",
  ],
};

export default function Privacy() {
  useEffect(() => {
    document.title = "Privacy Policy - MockAPI";
  }, []);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--secondary)/0.45)_100%)] px-4 py-8 text-foreground sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <article className="overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 shadow-[0_32px_80px_-32px_hsl(var(--foreground)/0.18)] backdrop-blur">
          <header className="border-b border-border/70 px-6 py-8 sm:px-10 sm:py-10">
            <div className="mb-3 inline-flex rounded-full border border-border/70 bg-secondary/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              MockAPI
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Privacy Policy</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              MockAPI (mockapi.online) - Last updated: April 10, 2026
            </p>
          </header>

          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <section className="space-y-6 text-[15px] leading-7 text-foreground/88 sm:text-base">
              <p>
                MockAPI ("we", "our", or "us") operates mockapi.online and
                api.mockapi.online. This Privacy Policy explains what information we collect,
                how we use it, and your rights regarding your data.
              </p>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">1. Information we collect</h2>
                <p className="mb-3">We collect information you provide directly to us:</p>
                <ul className="list-disc space-y-2 pl-6 text-foreground/80">
                  {sections.informationWeCollect.map((item) => (
                    <li key={item.title}>
                      <strong className="font-semibold text-foreground">{item.title}</strong>{" "}
                      {item.body}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">2. How we use your information</h2>
                <ul className="list-disc space-y-2 pl-6 text-foreground/80">
                  {sections.howWeUse.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>We do not sell your personal data to third parties.</p>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">3. Data storage and security</h2>
                <p>
                  Your data is stored on secure servers. We use industry-standard practices
                  including encrypted connections (HTTPS/WSS), hashed credentials, and access
                  controls. However, no system is 100% secure and we cannot guarantee absolute
                  security.
                </p>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">4. Third-party services</h2>
                <p className="mb-3">
                  We use the following third-party services, which have their own privacy
                  policies:
                </p>
                <ul className="list-disc space-y-2 pl-6 text-foreground/80">
                  {sections.thirdPartyServices.map((item) => (
                    <li key={item.title}>
                      <strong className="font-semibold text-foreground">{item.title}</strong>{" "}
                      - {item.body} (
                      <a
                        className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.linkLabel}
                      </a>
                      )
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">5. Cookies and sessions</h2>
                <p>
                  We use cookies and local storage to maintain your login session and
                  preferences. We do not use advertising cookies. You can clear cookies at any
                  time through your browser settings.
                </p>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">6. Data retention</h2>
                <p>
                  We retain your account data for as long as your account is active. Request
                  logs and tunnel session data are retained for up to 10 days by default. You
                  may deactivate your account at any time through the account settings page.
                  Certain account records may still be retained where required for legal
                  compliance, security review, and performance review purposes.
                </p>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">7. Your rights</h2>
                <p className="mb-3">You have the right to:</p>
                <ul className="list-disc space-y-2 pl-6 text-foreground/80">
                  {sections.yourRights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="mb-3">To exercise these rights, contact us at the email below.</p>

                <div className="mt-4 rounded-lg border border-border/50 bg-secondary/30 p-4">
                  <h4 className="mb-2 font-semibold">Data Export Details</h4>
                  <p className="mb-2 text-sm">When you request data export, we provide:</p>
                  <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                    <li>Your account profile information</li>
                    <li>All mock endpoints and their configurations</li>
                    <li>Request logs within the active retention period</li>
                    <li>Team workspace data and member information</li>
                    <li>API keys and authentication tokens in hashed form</li>
                    <li>Imported schemas such as OpenAPI, GraphQL SDL, and SOAP WSDL</li>
                  </ul>
                  <p className="mt-2 text-sm">
                    Data is provided in JSON format via a secure download link. Please allow up
                    to 7 business days for processing.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">8. Children&apos;s privacy</h2>
                <p>
                  MockAPI is not directed at children under the age of 13. We do not knowingly
                  collect personal information from children. If you believe a child has
                  provided us with personal information, please contact us.
                </p>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">9. Changes to this policy</h2>
                <p>
                  We may update this Privacy Policy from time to time. When we do, we will post
                  the updated version on this page and update the date at the top.
                </p>
              </section>

              <section>
                <h2 className="mb-3 text-xl font-semibold tracking-tight">10. Contact us</h2>
                <p>
                  If you have questions about this Privacy Policy or your data, please contact us
                  at:
                </p>
                <p className="mt-3">
                  <a
                    className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                    href="mailto:privacy@mockapi.online"
                  >
                    privacy@mockapi.online
                  </a>
                  <br />
                  For data export requests:{" "}
                  <a
                    className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                    href="mailto:export@mockapi.online"
                  >
                    export@mockapi.online
                  </a>
                  <br />
                  mockapi.online
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Please include your account email and specify "Data Export Request" in the
                  subject line for faster processing.
                </p>
              </section>
            </section>
          </div>

          <footer className="border-t border-border/70 px-6 py-6 text-sm text-muted-foreground sm:px-10">
            &copy; 2026 MockAPI -{" "}
            <a
              className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
              href="https://www.mockapi.online"
            >
              mockapi.online
            </a>
          </footer>
        </article>
      </div>
    </main>
  );
}
