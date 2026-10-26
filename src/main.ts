import '@fontsource-variable/inter/wght.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { resolveConfig } from './lib/config';

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const config = resolveConfig({
  env: import.meta.env as Record<string, string | undefined>,
  search: window.location.search,
  hostname: window.location.hostname,
  protocol: window.location.protocol,
  storage: safeStorage(),
});

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

export default mount(App, { target, props: { config } });
