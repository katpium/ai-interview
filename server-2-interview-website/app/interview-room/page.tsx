import { redirect } from "next/navigation";

// Old URL — redirect to the token-gated entry point.
// Candidates should use /interview?token=xxx (generated via /admin).
export default function InterviewRoomPage() {
  redirect("/interview");
}
