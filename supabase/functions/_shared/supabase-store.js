// Resolver bridge for './supabase-store.js'. The modules in this directory import each
// other by that name because TypeScript rejects '.ts' specifiers and Deno
// rewrites '.js' back to the '.ts' source. The Supabase CLI's bundler stats
// specifiers literally and applies no rewrite, so without this file it cannot
// find the module at all. One line, generated, no logic.
export * from './supabase-store.ts';
