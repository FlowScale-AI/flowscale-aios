export { bridge } from './bridge';
export { tools } from './tools';
export { providers } from './providers';
export { storage } from './storage';
export { ui } from './ui';
export { app } from './app';
export { instances } from './instances';
export { createClient, login } from './http';
export type { HttpClient, HttpClientOptions, LoginOptions } from './http';
export * from './types';

import { tools } from './tools';
import { providers } from './providers';
import { storage } from './storage';
import { ui } from './ui';
import { app } from './app';
import { instances } from './instances';

/** Convenience default export with all namespaces. */
const FlowScale = { tools, providers, storage, ui, app, instances } as const;
export default FlowScale;
