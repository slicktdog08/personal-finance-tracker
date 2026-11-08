"use client";

import { useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Icon, type IconName } from "./Icon";
import { Badge, type BadgeVariant } from "./data";
import type { VarStyle } from "./core";

export interface ColorOption {
  value: string;
  label: string;
  color: string;
  icon?: IconName;
}

/**
 * Monday-style edit-in-place for anything with a user color (category, bill status, payment
 * type): the badge is the control; tapping it opens a grid of solid color tiles — an anchored
 * popover at md+, a bottom sheet below (both via the shared Sheet primitive).
 */
export function ColorPicker({
  options,
  value,
  onChange,
  placeholder = "Choose",
  title = "Choose",
  allowNone = true,
  noneLabel = "None",
  size = "md",
  variant = "tint",
  disabled,
  className,
}: {
  options: ColorOption[];
  value: string | null | undefined;
  onChange?: (v: string | null) => void;
  placeholder?: string;
  title?: string;
  allowNone?: boolean;
  noneLabel?: string;
  size?: "sm" | "md" | "lg";
  variant?: BadgeVariant;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cur = options.find((o) => o.value === value);
  const list = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));

  const close = () => {
    setOpen(false);
    setQ("");
  };
  const pick = (v: string | null) => {
    onChange?.(v);
    close();
  };
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) setOpen((o) => !o);
  };

  return (
    <span ref={anchorRef} className={className} style={{ display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      {cur ? (
        <Badge label={cur.label} color={cur.color} icon={cur.icon} size={size} variant={variant} onClick={toggle} className="mp-badge--chevron" title="Change" />
      ) : (
        <Badge label={placeholder} variant="outline" dot={false} icon="plus" size={size} onClick={toggle} className="mp-badge--chevron" />
      )}
      <Sheet open={open} onClose={close} title={title} anchorRef={anchorRef} desktop="anchored" width={320}>
        {options.length > 8 && (
          <div className="mp-picker__search">
            <input className="mp-input mp-input--round" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        <div className="mp-picker" role="listbox" aria-label={title}>
          {allowNone && !q && (
            <button type="button" role="option" aria-selected={!value} className="mp-picker__opt mp-picker__opt--none" onClick={() => pick(null)}>
              <Icon name="circle-slash-2" size={14} />
              {noneLabel}
            </button>
          )}
          {list.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="mp-picker__opt"
              style={{ "--c": o.color } as VarStyle}
              onClick={() => pick(o.value)}
            >
              {o.icon && <Icon name={o.icon} size={14} />}
              <span className="mp-picker__label">{o.label}</span>
              {o.value === value && <Icon name="check" size={14} className="mp-picker__check" />}
            </button>
          ))}
        </div>
      </Sheet>
    </span>
  );
}
