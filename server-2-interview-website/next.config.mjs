import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  // Allow `next dev` to accept requests from HTTPS tunnels (Cloudflare,
  // ngrok, localtunnel, etc.). Without this, Next dev's "cross origin
  // request detected" guard silently breaks HMR and hydration — buttons
  // render but onClick handlers never attach.
  // Wildcards are supported; add specific tunnel hostnames as needed.
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.loca.lt",
  ],
};

export default nextConfig;
