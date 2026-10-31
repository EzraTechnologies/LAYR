import base from './playwright.config';

// Exercise the real authenticated app with a fixed, non-secret fixture key.
export default {
  ...base,
  outputDir: './test-results/auth',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4175' },
  projects: base.projects?.map(project => ({
    ...project,
    name: 'authenticated-chromium',
    testIgnore: [],
    testMatch: '**/thumbnail-cache.spec.ts',
  })),
  webServer: {
    command: 'npm run build -- --outDir /tmp/layr-auth-e2e --emptyOutDir && npx vite preview --outDir /tmp/layr-auth-e2e --port 4175 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4175',
    env: { VITE_LAYR_API_KEY: 'layr-playwright-fixture-key' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
};
