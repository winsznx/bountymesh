import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { Callout } from "@/components/docs/mdx/Callout";
import { Steps, Step } from "@/components/docs/mdx/Steps";
import { Tabs, Tab } from "@/components/docs/mdx/Tabs";
import { Card } from "@/components/docs/mdx/Card";
import { CardGroup } from "@/components/docs/mdx/CardGroup";
import { ParamTable, Param } from "@/components/docs/mdx/ParamTable";
import { ApiMethod } from "@/components/docs/mdx/ApiMethod";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // Custom Mintlify-style components
    Callout,
    Steps,
    Step,
    Tabs,
    Tab,
    Card,
    CardGroup,
    ParamTable,
    Param,
    ApiMethod,

    // Override default HTML elements with our typography
    h1: ({ children, ...rest }) => (
      <h1
        className="mb-4 mt-2 scroll-mt-24 text-3xl font-semibold tracking-tight text-abyssal-ink"
        {...rest}
      >
        {children}
      </h1>
    ),
    h2: ({ children, ...rest }) => (
      <h2
        className="mb-3 mt-10 scroll-mt-24 border-b border-ash-white pb-2 text-2xl font-semibold tracking-tight text-abyssal-ink"
        {...rest}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...rest }) => (
      <h3
        className="mb-2 mt-6 scroll-mt-24 text-lg font-semibold text-abyssal-ink"
        {...rest}
      >
        {children}
      </h3>
    ),
    p: ({ children, ...rest }) => (
      <p className="mb-4 leading-7 text-abyssal-ink/80" {...rest}>
        {children}
      </p>
    ),
    ul: ({ children, ...rest }) => (
      <ul className="mb-4 ml-6 list-disc space-y-2 text-abyssal-ink/80" {...rest}>
        {children}
      </ul>
    ),
    ol: ({ children, ...rest }) => (
      <ol className="mb-4 ml-6 list-decimal space-y-2 text-abyssal-ink/80" {...rest}>
        {children}
      </ol>
    ),
    li: ({ children, ...rest }) => (
      <li className="leading-7" {...rest}>
        {children}
      </li>
    ),
    a: ({ children, href, ...rest }) => {
      const isExternal = href?.startsWith("http");
      if (isExternal) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-digital-orange underline-offset-2 hover:underline"
            {...rest}
          >
            {children}
          </a>
        );
      }
      return (
        <Link
          href={href ?? "#"}
          className="text-digital-orange underline-offset-2 hover:underline"
        >
          {children}
        </Link>
      );
    },
    code: ({ children, className, ...rest }) => {
      // Inline code (no language class) — code blocks already styled by rehype-pretty-code
      if (!className) {
        return (
          <code
            className="rounded-sm bg-ash-white px-1.5 py-0.5 font-mono text-[0.9em] text-digital-orange"
            {...rest}
          >
            {children}
          </code>
        );
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
    pre: ({ children, ...rest }) => (
      <pre
        className="mb-4 overflow-x-auto rounded-md border border-ash-white bg-basalt-canvas p-4 text-sm leading-relaxed"
        {...rest}
      >
        {children}
      </pre>
    ),
    blockquote: ({ children, ...rest }) => (
      <blockquote
        className="mb-4 border-l-4 border-abyssal-ink/20 pl-4 italic text-abyssal-ink/60"
        {...rest}
      >
        {children}
      </blockquote>
    ),
    table: ({ children, ...rest }) => (
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-sm" {...rest}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...rest }) => (
      <thead className="border-b border-abyssal-ink/20 text-left text-abyssal-ink/60" {...rest}>
        {children}
      </thead>
    ),
    th: ({ children, ...rest }) => (
      <th className="px-3 py-2 font-medium" {...rest}>
        {children}
      </th>
    ),
    td: ({ children, ...rest }) => (
      <td className="border-b border-abyssal-ink/10 px-3 py-2 text-abyssal-ink/80" {...rest}>
        {children}
      </td>
    ),
    hr: ({ ...rest }) => <hr className="my-8 border-ash-white" {...rest} />,

    ...components,
  };
}
