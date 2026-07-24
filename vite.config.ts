import { defineConfig, type ProxyOptions } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const BACKEND = 'http://127.0.0.1:4600';

// Both proxies MUST use changeOrigin:true — the backend rejects any foreign
// Host header before routing (DNS-rebinding guard), so forwarding the Vite
// port's Host would 403 every request. The browser's Origin header (the Vite
// origin on POSTs) is rewritten too: the mutation guard only accepts the
// backend origin, and with a matching Origin the X-Fleet-Token stays the gate.
function backendProxy(extraConfigure?: ProxyOptions['configure']): ProxyOptions {
  return {
    target: BACKEND,
    changeOrigin: true,
    // Compose, never override: the Origin rewrite always applies, and callers
    // may layer extra hooks on top (dropping the rewrite would 403 every POST).
    configure(proxy, options) {
      proxy.on('proxyReq', (proxyReq) => {
        if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', BACKEND);
      });
      extraConfigure?.(proxy, options);
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [svelte(), tailwindcss()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    proxy: {
      // SSE: disable proxy buffering and flush headers immediately, otherwise
      // the live stream stalls ~15s (masked by the heartbeat, invisible on curl).
      '/events': backendProxy((proxy) => {
        proxy.on('proxyRes', (_proxyRes, _req, res) => {
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders?.();
        });
      }),
      '/api': backendProxy(),
    },
  },
});
