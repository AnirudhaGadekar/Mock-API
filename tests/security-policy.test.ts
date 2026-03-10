import { describe, expect, it } from 'vitest';
import { getEndpointSecurityPolicy, isIpAllowedByPolicy, maskHeadersByPolicy, resolveEffectiveSecurityPolicy } from '../src/lib/security-policy.js';

describe('security policy helpers', () => {
  it('allows localhost and configured CIDR ranges', () => {
    const policy = getEndpointSecurityPolicy({
      securityPolicy: {
        ipAllowlist: ['10.0.0.0/8', '192.168.1.0/24'],
      },
    });

    expect(isIpAllowedByPolicy('127.0.0.1', policy)).toBe(true);
    expect(isIpAllowedByPolicy('10.4.2.1', policy)).toBe(true);
    expect(isIpAllowedByPolicy('192.168.1.50', policy)).toBe(true);
    expect(isIpAllowedByPolicy('172.16.0.1', policy)).toBe(false);
  });

  it('masks headers with configured strategy', () => {
    const policy = getEndpointSecurityPolicy({
      securityPolicy: {
        maskedHeaders: ['x-secret-token'],
        maskingStrategy: 'partial',
      },
    });

    const result = maskHeadersByPolicy(
      {
        authorization: 'Bearer very-secret-token',
        'x-secret-token': 'abc123456789',
        'x-keep': 'visible',
      },
      policy,
    );

    expect(result.authorization).toContain('...');
    expect(result['x-secret-token']).toContain('...');
    expect(result['x-keep']).toBe('visible');
  });

  it('applies deterministic inheritance global -> team -> endpoint', () => {
    process.env.SECURITY_POLICY_GLOBAL_JSON = JSON.stringify({
      ipAllowlist: ['172.16.0.0/12'],
      maskedHeaders: ['x-global-secret'],
      maskingStrategy: 'hash',
      mtlsMode: 'optional',
    });
    process.env.SECURITY_POLICY_TEAM_JSON = JSON.stringify({
      team_1: {
        ipAllowlist: ['10.0.0.0/8'],
        maskedHeaders: ['x-team-secret'],
        maskingStrategy: 'partial',
      },
    });

    const policy = resolveEffectiveSecurityPolicy({
      securityPolicy: {
        maskedHeaders: ['x-endpoint-secret'],
        mtlsMode: 'required',
      },
    }, 'team_1');

    // ipAllowlist comes from nearest scope that defines it (team here).
    expect(policy.ipAllowlist).toEqual(['10.0.0.0/8']);
    // masking strategy comes from endpoint -> team -> global order.
    expect(policy.maskingStrategy).toBe('partial');
    // mtls mode from endpoint takes highest priority.
    expect(policy.mtlsMode).toBe('required');
    // masked headers are merged across all scopes + defaults.
    expect(policy.maskedHeaders).toContain('x-global-secret');
    expect(policy.maskedHeaders).toContain('x-team-secret');
    expect(policy.maskedHeaders).toContain('x-endpoint-secret');

    delete process.env.SECURITY_POLICY_GLOBAL_JSON;
    delete process.env.SECURITY_POLICY_TEAM_JSON;
  });

  it('keeps backwards-compatible endpoint-only policy parser', () => {
    const policy = getEndpointSecurityPolicy({
      securityPolicy: { maskedHeaders: ['x-legacy'] },
    });
    expect(policy.maskedHeaders).toContain('x-legacy');
  });
});
