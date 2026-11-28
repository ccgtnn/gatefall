import { SUPABASE_KEY, SUPABASE_URL } from './config.js';

export class CloudError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createCloudRequest(fetcher = globalThis.fetch) {
  return async (path, { method = 'GET', token, body, headers, keepalive = false } = {}) => {
    let response;
    try {
      response = await fetcher(SUPABASE_URL + path, {
        method, keepalive, signal: AbortSignal.timeout(8000),
        headers: {
          apikey: SUPABASE_KEY,
          ...(token && { Authorization: 'Bearer ' + token }),
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new CloudError('Облако не ответило вовремя.', 408);
      throw new CloudError('Нет сети.', 0);
    }
    const payload = response.status === 204 ? null : await response.json().catch((error) => {
      // A connection lost while reading a successful response is a network failure, not an empty answer.
      if (response.ok && error?.name !== 'SyntaxError') throw new CloudError('Нет сети.', 0);
      return null;
    });
    if (!response.ok) throw new CloudError('Ошибка облачного сервиса.', response.status, payload?.code);
    return payload;
  };
}
