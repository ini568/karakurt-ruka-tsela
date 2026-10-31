// Deliberately small event/DOM adapter, not an implementation of game behavior.
export class Target {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.listeners = new Map();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.textContent = '';
    this.captures = new Set();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, properties = {}) {
    const event = { preventDefault() {}, currentTarget: this, target: this, ...properties };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
  }
  append(...children) {
    for (const child of children) { child.parentElement = this; this.children.push(child); }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  focus() {}
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  querySelectorAll(selector) {
    return this.descendants().filter(node => selector === '[data-mute]' && 'mute' in node.dataset);
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
}

export function environment({ storage = '{broken', blocked = false } = {}) {
  const previous = new Map(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new Target('window');
  const document = new Target('document');
  document.createElement = tag => new Target(tag);
  document.hidden = false;
  const media = new Target('media');
  media.matches = false;
  window.matchMedia = () => media;
  window.getComputedStyle = () => ({ position: 'static' });
  const frames = new Map();
  let serial = 0;
  window.requestAnimationFrame = fn => { frames.set(++serial, fn); return serial; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const writes = [];
  window.localStorage = {
    getItem() { if (blocked) throw new Error('storage denied'); return storage; },
    setItem(key, value) { if (blocked) throw new Error('storage denied'); storage = value; writes.push({ key, value }); },
  };
  globalThis.window = window;
  globalThis.document = document;
  const host = new Target();
  const canvas = new Target('canvas');
  const overlay = new Target();
  const hud = new Target();
  host.append(canvas, overlay, hud);
  return {
    window, document, host, canvas, overlay, hud, media, frames, writes,
    tick(now) {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const fn of callbacks) fn(now);
    },
    restore() {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}
