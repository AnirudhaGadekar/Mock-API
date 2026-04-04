/**
 * Lightweight in-process Prometheus-style metrics implementation.
 * No external dependencies, but exposes a text-based `/metrics` endpoint
 * compatible with Prometheus format.
 */

type LabelMap = Record<string, string>;

class Counter {
  private readonly name: string;
  private readonly help: string;
  private readonly labelNames: string[];
  private readonly values = new Map<string, number>();

  constructor(opts: { name: string; help: string; labelNames?: string[] }) {
    this.name = opts.name;
    this.help = opts.help;
    this.labelNames = opts.labelNames ?? [];
  }

  private key(labels: LabelMap): string {
    return this.labelNames.map((k) => `${k}=${labels[k] ?? ''}`).join(',');
  }

  public inc(labels: LabelMap = {}, value = 1): void {
    const key = this.key(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + value);
  }

  public serialize(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} counter`);
    for (const [key, value] of this.values.entries()) {
      const labelPairs = key
        .split(',')
        .filter(Boolean)
        .map((pair) => {
          const [k, v] = pair.split('=');
          return `${k}="${v}"`;
        });
      const labelStr = labelPairs.length ? `{${labelPairs.join(',')}}` : '';
      lines.push(`${this.name}${labelStr} ${value}`);
    }
    return lines.join('\n');
  }
}

export const httpRequestsTotal = new Counter({
  name: 'mockapi_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'status_code', 'endpoint_id'],
});

export const httpRequestErrorsTotal = new Counter({
  name: 'mockapi_http_request_errors_total',
  help: 'Total number of HTTP requests resulting in 5xx errors',
  labelNames: ['method', 'status_code', 'endpoint_id'],
});

export const endpointRequestsTotal = new Counter({
  name: 'mockapi_endpoint_requests_total',
  help: 'Total number of requests per mock endpoint',
  labelNames: ['endpoint_id'],
});

export const policyDeniedTotal = new Counter({
  name: 'mockapi_policy_denied_total',
  help: 'Total number of requests denied by security policies',
  labelNames: ['policy', 'endpoint_id'],
});

export const maskedOutboundHeadersTotal = new Counter({
  name: 'mockapi_masked_outbound_headers_total',
  help: 'Total number of masked header fields in outbound payloads',
  labelNames: ['channel', 'endpoint_id'],
});

export const metricsRegistry = {
  contentType: 'text/plain; version=0; charset=utf-8',
  async metrics(): Promise<string> {
    const sections = [
      httpRequestsTotal.serialize(),
      httpRequestErrorsTotal.serialize(),
      endpointRequestsTotal.serialize(),
      policyDeniedTotal.serialize(),
      maskedOutboundHeadersTotal.serialize(),
    ];
    return sections.filter(Boolean).join('\n');
  },
};

export async function recordHttpRequest(params: {
  method: string;
  statusCode: number;
  endpointId?: string;
}): Promise<void> {
  const labels = {
    method: params.method.toUpperCase(),
    status_code: String(params.statusCode),
    endpoint_id: params.endpointId ?? 'unknown',
  };

  httpRequestsTotal.inc(labels);

  if (params.statusCode >= 500) {
    httpRequestErrorsTotal.inc(labels);
  }
}

export async function recordEndpointRequest(endpointId: string): Promise<void> {
  endpointRequestsTotal.inc({ endpoint_id: endpointId });
}
