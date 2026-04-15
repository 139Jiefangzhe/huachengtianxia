export type LayoutBlockType =
  | "banner"
  | "sidebar-nav"
  | "timeline-list"
  | "grid-list"
  | "simple-list"
  | "report-table"
  | "team-grid";

export type LayoutBlock = {
  type: LayoutBlockType | string;
  enabled?: boolean;
  props?: Record<string, unknown>;
};
