/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LAYR_MOONRAKER_URL?: string;
  readonly VITE_LAYR_PRINTER_NAME?: string;
  readonly VITE_LAYR_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __LAYR_VERSION__: string;
