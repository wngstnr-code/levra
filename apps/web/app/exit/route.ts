import { exitPageHtml } from "@/lib/exitPage";

export const dynamic = "force-static";

/** The "close without Levra" guide as one static file, the same one published on X Layer DeWEB (FE-82). */
export function GET() {
  return new Response(exitPageHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
}
