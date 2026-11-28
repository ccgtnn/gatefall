import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { TestNode } from '../helpers/test-node.js';

const voidTags = new Set(['img', 'input', 'link', 'meta']);

class StartupNode extends TestNode {
  get ownerDocument() { return document; }

  append(...nodes) {
    super.append(...nodes.map((node) => {
      if (typeof node !== 'string') return node;
      const text = new StartupNode('#text');
      text.textContent = node;
      return text;
    }));
  }

  after(node) {
    const { parent } = this;
    node.parent = parent;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
  }

  matches(selector) {
    const attribute = selector.match(/^\[([\w-]+)="([^"]*)"\]$/);
    return attribute ? this.getAttribute(attribute[1]) === attribute[2] : super.matches(selector);
  }

  // The page shell uses balanced tags, double-quoted attributes and void elements.
  set innerHTML(markup) {
    this.replaceChildren();
    const stack = [this];
    for (const [, closing, tag, attributes, content] of markup.matchAll(/<(\/)?([\w-]+)([^>]*)>|([^<]+)/g)) {
      if (!tag) {
        if (content.trim()) stack.at(-1).textContent = content.trim();
      } else if (closing) {
        assert.equal(stack.pop().tag, tag);
      } else {
        const node = new StartupNode(tag);
        for (const [, key, value] of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
          node.setAttribute(key, value ?? '');
          if (key === 'class') node.className = value;
          if (['id', 'value'].includes(key)) node[key] = value;
        }
        stack.at(-1).append(node);
        if (!voidTags.has(tag) && !attributes.endsWith('/')) stack.push(node);
      }
    }
    assert.equal(stack.length, 1);
  }
}

function startup(t) {
  const markup = readFileSync(new URL('../../docs/index.html', import.meta.url), 'utf8');
  const body = new StartupNode('body');
  body.innerHTML = markup.split('<body>')[1].split('</body>')[0];
  const document = Object.assign(new EventTarget(), {
    body, documentElement: new StartupNode('html'),
    createElement: (tag) => new StartupNode(tag),
    createElementNS: (_namespace, tag) => new StartupNode(tag),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    getElementById: (id) => body.querySelector('#' + id),
  });
  const data = new Map();
  const localStorage = {
    get length() { return data.size; },
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
  const matchMedia = () => Object.assign(new EventTarget(), { matches: false });
  const window = Object.assign(new EventTarget(), {
    localStorage, matchMedia,
    location: new URL('https://example.test/gatefall/'),
    history: { replaceState(state) { this.state = state; } },
  });
  const globals = { document, window, localStorage, matchMedia };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  t.after(() => {
    window.dispatchEvent(new Event('pagehide'));
    for (const key of Object.keys(globals)) delete globalThis[key];
  });

  return { document, window, data };
}

test('app starts from the page shell and renders the main screen without a session', async (t) => {
  const { document } = startup(t);
  await import('../../docs/app.js');
  await setImmediate();

  const home = document.querySelector('#screen').querySelector('.deck-home');
  assert.ok(home?.querySelector('.quick-match'));
  assert.ok(document.querySelector('#settings').querySelector('.cloud-settings'));
});

for (const failures of [1, 2]) {
  test(`render retries once after ${failures} rendering error(s)`, async (t) => {
    const { document, window, data } = startup(t);
    data.set('test-saved-progress', 'preserved');
    const screen = document.querySelector('#screen');
    const replace = screen.replaceChildren.bind(screen);
    let attempts = 0;
    t.mock.method(screen, 'replaceChildren', (...children) => {
      replace(...children);
      if (children[0]?.classList.contains('deck-home') && ++attempts <= failures) {
        throw new Error('Injected render failure');
      }
    });
    const errors = t.mock.method(console, 'error', () => {});
    const reload = t.mock.fn();
    window.location.reload = reload;

    await import(`../../docs/app.js?render-failures=${failures}`);
    await setImmediate();

    assert.equal(attempts, 2);
    assert.equal(errors.mock.callCount(), failures);
    if (failures === 1) {
      assert.ok(screen.querySelector('.deck-home'));
      assert.equal(reload.mock.callCount(), 0);
    } else {
      assert.equal(screen.querySelector('h2').textContent, 'Что-то пошло не так');
      const menu = screen.querySelector('button');
      assert.equal(menu.textContent, 'В меню');
      menu.dispatchEvent(new Event('click'));
      assert.equal(reload.mock.callCount(), 1);
      assert.equal(data.get('test-saved-progress'), 'preserved');
    }
  });
}
