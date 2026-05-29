import type { ReactNode } from "react";

export function CardGroup({
  cols = 2,
  children,
}: {
  cols?: 2 | 3;
  children: ReactNode;
}) {
  const colClass = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return (
    <div className={`my-6 grid grid-cols-1 gap-4 ${colClass}`}>{children}</div>
  );
}
