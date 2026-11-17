export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:8080';
  if (window.location.port === '5173') {
    return 'http://localhost:8080';
  }
  return '';
}

export function getWsBaseUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:8080/ws';
  if (window.location.port === '5173') {
    return 'ws://localhost:8080/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
