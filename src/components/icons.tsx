// Small inline-SVG icon set (decorative). Zero dependency. Each takes standard SVG props
// so size/color come from `className` (stroke uses currentColor).

type IconProps = React.SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function ListIcon(props: IconProps) {
  return (
    <svg {...base} width="20" height="20" {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="3.5" cy="12" r="1" />
      <circle cx="3.5" cy="18" r="1" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...base} width="20" height="20" {...props}>
      <path d="M3 7v4.5a2 2 0 0 0 .6 1.4l7.5 7.5a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.8L11 5.5A2 2 0 0 0 9.6 5H5a2 2 0 0 0-2 2Z" />
      <circle cx="7.5" cy="9.5" r="1.3" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base} width="20" height="20" {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <svg {...base} width="18" height="18" strokeWidth={2} {...props}>
      <circle cx="9" cy="6" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base} width="16" height="16" {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} width="18" height="18" {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base} width="16" height="16" {...props}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...base} width="20" height="20" {...props}>
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M12 15V3" />
      <path d="M7.5 7.5 12 3l4.5 4.5" />
    </svg>
  );
}

// Indeterminate spinner: the arc spins via `animate-spin`, the faint ring is the track.
export function SpinnerIcon(props: IconProps) {
  return (
    <svg {...base} width="16" height="16" {...props} className={`animate-spin ${props.className ?? ""}`}>
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <svg {...base} width="20" height="20" {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}

export function ScissorsIcon(props: IconProps) {
  return (
    <svg {...base} width="16" height="16" {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} width="16" height="16" {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// Closed padlock — filled body so "locked" reads as solid at a glance.
export function LockIcon(props: IconProps) {
  return (
    <svg {...base} width="16" height="16" {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" stroke="none" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Open padlock — outline body, shackle swung clear so it can't be mistaken for the closed one.
export function UnlockIcon(props: IconProps) {
  return (
    <svg {...base} width="16" height="16" {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.6-1.6" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} width="20" height="20" {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function BankIcon(props: IconProps) {
  return (
    <svg {...base} width="20" height="20" {...props}>
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v9M9 10v9M15 10v9M19 10v9" />
      <path d="M3 19h18" />
    </svg>
  );
}
