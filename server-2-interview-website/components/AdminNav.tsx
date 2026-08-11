"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

type AuthUser = { username: string; role: string };

type NavLink = { href: string; label: string; icon: string; roles?: string[] };

const NAV_LINKS: NavLink[] = [
  { href: "/admin",                label: "Invite Links",   icon: "🔗" },
  { href: "/admin/questions",      label: "Questions",      icon: "📋" },
  { href: "/admin/company-files",  label: "Company Files",  icon: "📁", roles: ["admin","technician"] },
  { href: "/review",               label: "Sessions",       icon: "🎤" },
];

const ROLE_COLOURS: Record<string, string> = {
  admin:      "bg-indigo-900/50 text-indigo-300 border-indigo-700/40",
  recruiter:  "bg-emerald-900/50 text-emerald-300 border-emerald-700/40",
  hr:         "bg-purple-900/50 text-purple-300 border-purple-700/40",
  technician: "bg-amber-900/50 text-amber-300 border-amber-700/40",
};

export default function AdminNav() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then((d: { user: AuthUser | null }) => setUser(d.user ?? null))
      .catch(() => {});
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <nav className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-sm sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-6 py-0">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white text-sm font-bold">
              AI
            </div>
            <span className="hidden sm:block text-sm font-semibold text-neutral-200">
              Interview Platform
            </span>
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {NAV_LINKS
              .filter(link => !link.roles || !user || link.roles.includes(user.role))
              .map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    isActive(link.href)
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
                  }`}
                >
                  <span className="text-base leading-none">{link.icon}</span>
                  <span>{link.label}</span>
                </Link>
              ))}
          </div>

          {/* User + sign out */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {user && (
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-sm text-neutral-400">@{user.username}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOURS[user.role] ?? "bg-neutral-800 text-neutral-400 border-neutral-700"}`}>
                  {user.role}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-400 transition hover:border-red-700 hover:text-red-400"
            >
              Sign out
            </button>
          </div>

        </div>
      </div>
    </nav>
  );
}
