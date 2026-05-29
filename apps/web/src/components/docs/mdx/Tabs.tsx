"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import { Children, isValidElement, type ReactNode } from "react";

type TabProps = { label: string; children: ReactNode };

export function Tabs({ children }: { children: ReactNode }) {
  const tabs = Children.toArray(children).filter(
    isValidElement,
  ) as React.ReactElement<TabProps>[];
  const labels = tabs.map((t) => t.props.label);
  if (labels.length === 0) return null;

  return (
    <RadixTabs.Root defaultValue={labels[0]} className="my-6">
      <RadixTabs.List className="flex gap-1 border-b border-ash-white">
        {labels.map((label) => (
          <RadixTabs.Trigger
            key={label}
            value={label}
            className="border-b-2 border-transparent px-4 py-2 text-sm text-abyssal-ink/60 transition-colors data-[state=active]:border-digital-orange data-[state=active]:text-digital-orange hover:text-abyssal-ink"
          >
            {label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.props.label} value={tab.props.label} className="pt-4">
          {tab.props.children}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

export function Tab({ label, children }: TabProps): null {
  // Marker component: parent Tabs inspects label/children props directly via
  // Children.toArray. This function never renders its own output.
  void label;
  void children;
  return null;
}
