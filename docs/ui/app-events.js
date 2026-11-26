const events = new EventTarget();

export function emit(type, detail) {
  events.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, handler, { signal } = {}) {
  const listener = (event) => handler(event.detail);
  events.addEventListener(type, listener, { signal });
  return () => events.removeEventListener(type, listener);
}
