"use client";

import { useEffect, useState } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

export function TableOfContents() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLHeadingElement>(
      "article h2[id], article h3[id]",
    );
    const collected: Heading[] = Array.from(nodes).map((el) => ({
      id: el.id,
      text: el.textContent ?? "",
      level: el.tagName === "H2" ? 2 : 3,
    }));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot DOM scrape on route mount
    setHeadings(collected);

    if (collected.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  if (headings.length === 0) return null;

  return (
    <aside className="hidden w-56 shrink-0 px-4 py-8 xl:block">
      <div className="sticky top-24">
        <div className="mb-3 font-mono text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
          On this page
        </div>
        <ul className="space-y-2 text-sm">
          {headings.map((h) => (
            <li
              key={h.id}
              style={{ paddingLeft: h.level === 3 ? "12px" : "0" }}
            >
              <a
                href={`#${h.id}`}
                className={`block leading-snug transition-colors ${
                  activeId === h.id
                    ? "text-digital-orange"
                    : "text-abyssal-ink/60 hover:text-abyssal-ink"
                }`}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
