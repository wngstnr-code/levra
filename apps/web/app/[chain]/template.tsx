/** Re-mounts on every page change, so each page eases in once. */
export default function ChainTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
