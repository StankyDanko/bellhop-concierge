// Thin JSON client for /api. Every call resolves to { ok, status, data } and never throws,
// so each screen can render its own error state next to the thing that failed.

export async function api(path, { method = 'GET', body, adminToken, signal } = {}) {
  try {
    const res = await fetch(`/api${path}`, {
      method,
      signal,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(adminToken ? { 'X-Admin-Token': adminToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok && data?.ok !== false, status: res.status, data };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, status: 0, data: null, aborted: true };
    return { ok: false, status: 0, data: null };
  }
}
