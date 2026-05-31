import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import tailwindModule from '@tailwindcss/vite';
import fs from 'fs';

const tailwindcss = tailwindModule.default || tailwindModule;
const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));

export default defineConfig({
  plugins: [
    tailwindcss(),
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      input: {
        sandbox: 'sandbox/index.html',
        history: 'history/index.html',
        wordbook: 'wordbook/index.html',
        pdf: 'pdf/viewer.html',
      },
    },
  },
});
