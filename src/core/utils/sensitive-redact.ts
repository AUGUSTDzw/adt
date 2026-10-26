const SENSITIVE_KEYS = /^(pass|password|passwd|secret|token|apikey|api_key|authorization|userpw|clientsecret)$/i;

export function redact<T>(input: T): T {
  if (typeof input === 'string') {
    return input.replace(/(password|passwd|secret|token|apikey|api_key)=\S+/gi, '$1=[REDACTED]') as T;
  }
  if (input && typeof input === 'object') {
    if (Array.isArray(input)) return input.map(redact) as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v);
    }
    return out as T;
  }
  return input;
}
