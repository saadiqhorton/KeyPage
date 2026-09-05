import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type StubNode = {
  tagName: string;
  nodeType: number;
  id: string;
  style: Record<string, string>;
  children: StubNode[];
  parentNode: StubNode | null;
  ownerDocument: unknown;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild(child: StubNode): StubNode;
  removeChild(child: StubNode): StubNode;
  addEventListener(): void;
  removeEventListener(): void;
  contains(): boolean;
  querySelector(): null;
  querySelectorAll(): StubNode[];
};

function createStubNode(tag: string): StubNode {
  const attributes: Record<string, string> = {};
  const node: StubNode = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    id: "",
    style: {},
    children: [],
    parentNode: null,
    ownerDocument: null,
    setAttribute(name, value) {
      attributes[name] = value;
    },
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((entry) => entry !== child);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    contains() {
      return false;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return node;
}

function installBrowserStubs(): { root: StubNode } {
  const root = createStubNode("div");
  root.id = "root";
  const body = createStubNode("body");
  const documentElement = createStubNode("html");
  body.appendChild(root);

  const history = {
    state: { idx: 0 } as { idx: number },
    replaceState(state: { idx?: number }) {
      this.state = { ...this.state, ...state };
    },
    pushState(state: { idx?: number }) {
      this.state = { ...this.state, ...state };
    },
    go() {},
    back() {},
    forward() {},
    length: 1,
  };

  const location = {
    pathname: "/",
    search: "",
    hash: "",
    href: "http://127.0.0.1:9090/",
    origin: "http://127.0.0.1:9090",
    host: "127.0.0.1:9090",
    hostname: "127.0.0.1",
    protocol: "http:",
    assign() {},
    replace() {},
    reload() {},
  };

  const document = {
    nodeType: 9,
    body,
    documentElement,
    head: createStubNode("head"),
    defaultView: null as unknown,
    readyState: "complete",
    HTMLIFrameElement: class HTMLIFrameElement {},
    getElementById(id: string) {
      return id === "root" ? root : null;
    },
    createElement(tag: string) {
      const node = createStubNode(tag);
      node.ownerDocument = document;
      return node;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const window = {
    document,
    history,
    location,
    addEventListener() {},
    removeEventListener() {},
    innerHeight: 800,
    innerWidth: 1200,
    requestAnimationFrame(callback: (time: number) => void) {
      return setTimeout(() => callback(0), 0);
    },
    cancelAnimationFrame(id: number) {
      clearTimeout(id);
    },
    window: null as unknown,
    self: null as unknown,
  };
  window.window = window;
  window.self = window;
  document.defaultView = window;
  root.ownerDocument = document;

  Object.assign(globalThis, {
    window,
    document,
    history,
    location,
    HTMLElement: class HTMLElement {},
    Element: class Element {},
    Node: class Node {},
    SVGElement: class SVGElement {},
  });

  return { root };
}

const { root: appRoot } = installBrowserStubs();

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react-dom/client") {
    return {
      shortCircuit: true,
      url: "data:text/javascript;charset=utf-8," + encodeURIComponent(\`
        export function createRoot(container) {
          globalThis.__keypageMainRoot = container;
          return {
            render(tree) { globalThis.__keypageMainTree = tree; },
            unmount() {},
          };
        }
      \`),
    };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return { format: "module", shortCircuit: true, source: "export default {};" };
  }
  return nextLoad(url, context);
}
`),
  import.meta.url,
);

function collectRoutePaths(routes: Array<{ path?: string; children?: unknown }> | undefined): string[] {
  const paths: string[] = [];
  for (const route of routes ?? []) {
    if (typeof route.path === "string") {
      paths.push(route.path);
    }
    if (Array.isArray(route.children)) {
      paths.push(
        ...collectRoutePaths(route.children as Array<{ path?: string; children?: unknown }>),
      );
    }
  }
  return paths;
}

describe("browser router table", () => {
  it("wires every product path through LoadingGate", async () => {
    const { router, Guarded, LoadingGate } = await import("@/routes/router.js");
    assert.equal(typeof Guarded, "function");
    assert.equal(typeof LoadingGate, "function");
    assert.deepEqual(collectRoutePaths(router.routes), [
      "/",
      "/settings",
      "/recovery-codes",
      "/setup",
      "/unlock",
      "/recover",
      "*",
    ]);
  });
});

describe("App shell", () => {
  it("renders the loading gate until vault status arrives", async () => {
    const { default: App } = await import("@/App.js");
    const html = renderToStaticMarkup(createElement(App));
    assert.match(html, />STARTING</);
    assert.match(html, /Loading vault/);
    assert.match(html, />KeyPage</);
  });
});

describe("main bootstrap", () => {
  it("mounts App onto #root inside StrictMode", async () => {
    const { default: App } = await import("@/App.js");
    const { StrictMode } = await import("react");
    await import("@/main.js");
    const globals = globalThis as {
      __keypageMainRoot?: StubNode;
      __keypageMainTree?: { type: unknown; props: { children: { type: unknown } } };
    };
    assert.equal(globals.__keypageMainRoot, appRoot);
    const tree = globals.__keypageMainTree;
    assert.ok(tree && isValidElement(tree));
    assert.equal(tree.type, StrictMode);
    assert.ok(isValidElement(tree.props.children));
    assert.equal(tree.props.children.type, App);
  });
});
