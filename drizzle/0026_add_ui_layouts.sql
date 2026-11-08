-- Saved dashboard arrangement: widget order, widths and heights, set by dragging and resizing on
-- /dashboard. One row per page; the JSON is normalized on read (src/lib/dashboard-layout.ts), so a
-- missing row or a stale one just falls back to / merges with the default layout.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0026_add_ui_layouts.sql
CREATE TABLE `ui_layouts` (
  `layout_key` varchar(48) NOT NULL,
  `layout` json NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`layout_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
