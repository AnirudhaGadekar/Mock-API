import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Code2, ExternalLink, FileCode2, Shield, TerminalSquare } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? `http://${window.location.hostname}:3000`;

const EXAMPLES = [
  {
    title: "List Endpoints",
    code: `curl -X GET "${API_BASE}/api/v2/endpoints" \\\n  -H "X-API-Key: <your_api_key>"`,
  },
  {
    title: "Create Endpoint",
    code: `curl -X POST "${API_BASE}/api/v2/endpoints" \\\n  -H "X-API-Key: <your_api_key>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"my-endpoint"}'`,
  },
  {
    title: "Configure Chaos",
    code: `curl -X PUT "${API_BASE}/api/v2/chaos/<endpoint_id>" \\\n  -H "X-API-Key: <your_api_key>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"enabled":true,"errorInject":{"probability":0.3,"status":503}}'`,
  },
];

export default function ApiExplorerPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileCode2 className="h-6 w-6 text-primary" />
          API Explorer
        </h2>
        <p className="text-muted-foreground">
          Access interactive docs, run API checks quickly, and copy production-ready request snippets.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Interactive Swagger</CardTitle>
            <CardDescription>Open full OpenAPI UI with try-it-now requests.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => window.open("/documentation", "_blank")}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Swagger UI
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Admin Console</CardTitle>
            <CardDescription>Access system analytics, users, and logs.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => window.open("/admin.html", "_blank")}>
              <Shield className="h-4 w-4 mr-2" />
              Open Admin Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TerminalSquare className="h-4 w-4" />
            Quick Request Examples
          </CardTitle>
          <CardDescription>Copy and run in terminal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {EXAMPLES.map((example) => (
            <div key={example.title} className="space-y-2">
              <div className="text-sm font-medium">{example.title}</div>
              <pre className="rounded-md border bg-muted/40 p-3 text-xs overflow-x-auto">
                <code>{example.code}</code>
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Code2 className="h-4 w-4" />
            Base URL
          </CardTitle>
          <CardDescription>Current API base used by frontend runtime.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="text-xs font-mono">{API_BASE}</code>
        </CardContent>
      </Card>
    </div>
  );
}


