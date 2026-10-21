import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Injects the SHA-256 hash of every inline <script> into the CSP meta tag.
 *
 * The single-file build inlines the whole bundle into index.html, and an
 * inline script is only allowed by the CSP if its exact hash is listed.
 * The inlining happens in `generateBundle`, so the hash has to be computed
 * there as well — this plugin must therefore be listed *after*
 * vite-plugin-singlefile.
 */
function cspHashPlugin(): Plugin {
  return {
    name: 'csp-inline-script-hash',
    // same enforce group as vite-plugin-singlefile; within the group the
    // plugin array order decides, and this plugin is listed last
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const [fileName, asset] of Object.entries(bundle)) {
          if (fileName !== 'index.html' || asset.type !== 'asset') continue;
          const html = String(asset.source);
          const hashes: string[] = [];
          const scanned = html.replace(
            /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
            (match, attrs: string, body: string) => {
              // only inline scripts (no src) need a hash
              if (/\bsrc\s*=/.test(attrs)) return match;
              if (body.trim() === '') return match;
              const hash = createHash('sha256').update(body, 'utf8').digest('base64');
              hashes.push(`'sha256-${hash}'`);
              return match;
            }
          );
          let out = scanned.replace(/\s*__CSP_SCRIPT_HASH__/g, '');
          if (hashes.length > 0) {
            out = out.replace(/script-src 'self'/, `script-src 'self' ${hashes.join(' ')}`);
          }
          asset.source = out;
        }
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // must stay after viteSingleFile: the hash is computed on the inlined script
    ...(mode === 'single' ? [viteSingleFile()] : []),
    cspHashPlugin(),
  ],
  build: {
    outDir: 'dist',
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
}));
