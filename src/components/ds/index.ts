// MiPlata design system — React primitives over the mp-* classes in src/styles/miplata.
// Import from "@/components/ds", not the individual files.
// Source of truth: the "MiPlata Design System" project on claude.ai/design.
export { Icon, type IconName, type IconProps } from "./Icon";
export { BrandMark, Wordmark } from "./brand";
export {
  Button,
  IconButton,
  Card,
  Money,
  buttonClass,
  cx,
  type ButtonProps,
  type ButtonVariant,
  type IconButtonProps,
  type CardProps,
  type MoneyKind,
  type MoneyProps,
  type VarStyle,
} from "./core";
export {
  Badge,
  Glyph,
  ListRow,
  ProgressBar,
  StatTile,
  DataTable,
  type BadgeProps,
  type BadgeVariant,
  type ProgressBarProps,
  type StatTileProps,
  type DataTableColumn,
  type DataTableMobile,
  type DataTableProps,
  type DataTableRowState,
} from "./data";
export { Notice, AttentionStrip, EmptyState, Skeleton, type NoticeTone, type AttentionItem } from "./feedback";
export {
  Field,
  Input,
  Select,
  Checkbox,
  Switch,
  Segmented,
  Slider,
  FilterBar,
  type InputProps,
  type SelectOption,
  type SegmentedOption,
  type FilterChip,
} from "./forms";
export { PageHeader, MonthNav, SubTabs, LinkTabs, type SubTab } from "./navigation";
export { ColorPicker, type ColorOption } from "./ColorPicker";
export { AppShell, type AppShellProps } from "./AppShell";
export { SyncButton } from "./SyncButton";
// Loading feel: launch splash, navigation progress, pressed-link marker, route skeletons.
export { ActivityIndicator } from "./ActivityIndicator";
export { LaunchSplash } from "./LaunchSplash";
export { NavProgress } from "./NavProgress";
export { LinkPending } from "./LinkPending";
export { PageSkeleton, type PageSkeletonProps } from "./PageSkeleton";
// The modal/bottom-sheet primitive predates the design system and keeps its API
// (anchored popover, focus trap, data-popover-root); it's restyled to MiPlata tokens.
export { Sheet } from "@/components/ui/Sheet";
