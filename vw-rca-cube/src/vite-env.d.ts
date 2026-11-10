/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_IS_PREVIEW: string;
  readonly VITE_VIKTOR_AUTH_CLIENT_ID?: string;
  readonly VITE_VIKTOR_SPACES_ACCESS_MODE?: string;
  readonly VITE_VIKTOR_SPACES_API_URL?: string;
  readonly VITE_VIKTOR_SPACES_AUTH_PROVIDERS?: string;
  readonly VITE_VIKTOR_SPACES_SPACE_ID?: string;
  readonly VITE_USERTOUR_TOKEN?: string;
  readonly VITE_USERTOUR_OVERVIEW_FLOW?: string;
  readonly VITE_USERTOUR_GZ_FLOW?: string;
  readonly VITE_USERTOUR_GZ_REP_FLOW?: string;
  readonly VITE_USERTOUR_FZ_FLOW?: string;
  readonly VITE_USERTOUR_FZ_OVERVIEW_FLOW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
