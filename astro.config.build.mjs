import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://blog.umyar.com',
  output: 'static',
  outDir: '/tmp/blog-dist',
  cacheDir: '/tmp/blog-astro-cache',
  integrations: [react(), mdx()],
  vite: {
    plugins: [tailwindcss()],
    cacheDir: '/tmp/blog-vite-cache',
  },
});
