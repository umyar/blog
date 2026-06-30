import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import keystatic from '@keystatic/astro';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://blog.umyar.com',
  output: 'static', // dynamic routes (Keystatic, /api/*) opt in via `export const prerender = false`
  adapter: vercel(),
  integrations: [mdx(), sitemap(), keystatic()],
  vite: {
    plugins: [tailwindcss()],
  },
});
