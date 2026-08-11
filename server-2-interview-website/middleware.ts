import { type NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { ROUTE_PERMISSIONS, hasPermission } from "@/lib/rbac";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const reqMethod = req.method ?? "GET";

  // Always public — candidates need these without auth.
  if (pathname === "/api/sessions" && reqMethod === "POST") return NextResponse.next();
  if (pathname.startsWith("/api/admin/verify-invite")) return NextResponse.next();

  // Find the first matching route rule (method-aware).
  const rule = ROUTE_PERMISSIONS.find(
    (r) =>
      r.pattern.test(pathname) &&
      (!r.methods || r.methods.includes(reqMethod.toUpperCase()))
  );

  if (!rule) return NextResponse.next(); // public route

  // Verify JWT.
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Check permission via RBAC table.
  if (!hasPermission(payload.role as string, rule.permission)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: `Forbidden — your role (${payload.role}) does not have permission: ${rule.permission}`,
        },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/review/:path*",
    "/admin/:path*",
    "/api/sessions",
    "/api/sessions/:path*",
    "/api/evaluate-interview/:path*",
    "/api/re-evaluate-interview/:path*",
    "/api/generate-questions/:path*",
    "/api/question-bank/:path*",
    "/admin/company-files/:path*",
    "/api/admin/:path*",
  ],
};
