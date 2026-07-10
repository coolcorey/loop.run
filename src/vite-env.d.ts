/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POCKETBASE_URL?: string
  readonly VITE_AI_PROVIDER?: string
  readonly VITE_API_BASE?: string
  readonly VITE_MAP_STYLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
