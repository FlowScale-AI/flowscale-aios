# FlowScale Image Generator — Example App

A standalone React + Vite app that connects to a running FlowScale AIOS instance, lists your production tools, and lets you run them directly from the browser.

## Prerequisites

- FlowScale AIOS running on `http://localhost:14173`
- Node.js >= 18

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:5174](http://localhost:5174), sign in with your FlowScale credentials, and select a tool.

## How it works

All API calls go through Vite's dev proxy (`/api/*` → `http://localhost:14173`). This sidesteps CORS and cookie restrictions that would otherwise block browser-to-FlowScale communication. The app uses raw `fetch` with `credentials: 'include'` rather than `@flowscale/sdk`'s `createClient()`, which is designed for Node.js.

## Targeting a different instance

Change the `proxy.target` in `vite.config.ts` and restart the dev server:

```ts
proxy: {
  '/api': {
    target: 'http://your-instance:14173',
    ...
  },
},
```

## Production deployment

Build with `npm run build`, then serve `dist/` behind a reverse proxy (nginx, Caddy, etc.) that forwards `/api/*` to your FlowScale instance.
