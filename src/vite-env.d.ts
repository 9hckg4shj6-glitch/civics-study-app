/// <reference types="vite/client" />

declare module "virtual:pwa-register" {
  export function registerSW(options?: {
    immediate?: boolean;
    /** 新版が有効になり、通常なら再読み込みされる場面。渡すと再読み込みを自分で決められる */
    onNeedReload?: () => void;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }): (reloadPage?: boolean) => Promise<void>;
}
