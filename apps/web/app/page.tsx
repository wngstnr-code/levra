import { redirect } from "next/navigation";
import { chainPath, defaultChain } from "@/lib/chains";

export default function HomePage() {
  redirect(chainPath(defaultChain, "/markets"));
}
