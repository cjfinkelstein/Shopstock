export interface User {
  id: number;
  name: string;
  role: "tech" | "admin";
  email: string | null;
  active: boolean;
  has_pin: boolean;
  pin?: string | null; // plaintext — only populated on admin-only endpoints
  hourly_rate?: string | null; // admin-only field, never rendered in the tech app
}

export interface TechName {
  id: number;
  name: string;
  has_pin: boolean;
}

export interface Item {
  id: number;
  sku: string;
  barcode: string;
  name: string;
  description: string | null;
  image_data?: string | null;
  category: string;
  unit: "each" | "box" | "foot";
  active: boolean;
  notes: string | null;
  // admin only:
  avg_cost?: string;
  last_cost?: string;
  reorder_point?: string;
  reorder_qty?: string;
  vendors?: string[];
  on_hand?: string;
  received?: string;
  used?: string;
  total_spent?: string;
  dates_bought?: string[];
}

export interface StockLocationRow {
  location_id: number;
  location_name: string;
  location_type: "shop" | "truck";
  qty: string;
}

export interface ItemStock {
  item_id: number;
  total: string;
  locations: StockLocationRow[];
}

export interface Location {
  id: number;
  type: "shop" | "truck";
  truck_id: number | null;
  name: string;
  active: boolean;
}

export interface Truck {
  id: number;
  name: string;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  active: boolean;
  location: Location | null;
}

export interface Vendor {
  id: number;
  name: string;
  active: boolean;
}

export interface Job {
  id: number;
  job_number: string;
  name: string;
  customer: string | null;
  address: string | null;
  status: "active" | "closed";
}

export interface Txn {
  id: number;
  type: "RECEIVE" | "SIGN_OUT" | "RETURN" | "TRANSFER" | "ADJUST";
  item_id: number;
  item_sku: string | null;
  item_name: string | null;
  item_unit: string | null;
  item_image?: string | null;
  qty: string;
  from_location_id: number | null;
  from_location_name: string | null;
  to_location_id: number | null;
  to_location_name: string | null;
  job_id: number | null;
  job_number: string | null;
  job_name: string | null;
  user_id: number;
  user_name: string | null;
  ref: string | null;
  note: string | null;
  reason: string | null;
  went_negative: boolean;
  created_at: string;
  unit_cost?: string | null;
  tax_amount?: string | null;
  vendor_name?: string | null;
}

export interface TxnPage {
  total: number;
  page: number;
  page_size: number;
  items: Txn[];
}

export interface StockRow {
  item_id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  image_data?: string | null;
  location_id: number;
  location_name: string;
  qty: string;
}

export interface TechDashboard {
  my_transactions: Txn[];
  my_truck: { truck_id: number; truck_name: string; location_id: number; item_count: number } | null;
}

export interface CartLine {
  item: Item;
  qty: string;
  from_location_id: number | null; // null = decide at checkout by default rule
}

export interface ClockStatus {
  clocked_in: boolean;
  clock_event_id?: number | null;
  clock_in_at?: string | null;
  job_id?: number | null;
  job_number?: string | null;
  job_name?: string | null;
  approval_status?: string | null;
  gps_consent_given: boolean;
}

export interface WorkerLive {
  user_id: number;
  user_name: string;
  job_number: string | null;
  job_name: string | null;
  clock_in_at: string;
  approval_status: string;
  lat: number | null;
  lng: number | null;
  last_ping_at: string | null;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  at: string;
  kind: "clock_in" | "ping" | "clock_out";
}

export interface ShiftRoute {
  user_name: string;
  job_number: string | null;
  job_name: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  points: RoutePoint[];
}

export interface CalendarEventEdit {
  id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  edited_by_name: string | null;
  created_at: string;
}

export interface CalendarEvent {
  id: number;
  event_date: string;
  title: string;
  notes: string | null;
  done: boolean;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  edits: CalendarEventEdit[];
}

export interface JobMaterialsOut {
  job: Job;
  lines: {
    item_id: number;
    sku: string;
    name: string;
    unit: string;
    image_data?: string | null;
    source: string;
    vendor?: string | null;
    qty_signed_out: string;
    qty_returned: string;
    net_qty: string;
    avg_snapshot_cost: string;
    net_cost: string;
  }[];
  activity: {
    id: number;
    created_at: string;
    type: "SIGN_OUT" | "RETURN";
    sku: string;
    item_name: string;
    unit: string;
    image_data?: string | null;
    qty: string;
    source: string;
    vendor?: string | null;
    user_name: string;
  }[];
  total_cost: string;
}

export interface EstimateLine {
  id: number;
  item_id: number | null;
  sku?: string | null;
  image_data?: string | null;
  description: string;
  qty: string;
  unit: string;
  material_unit_cost: string;
  labor_unit_cost: string;
  material_total: string;
  labor_total: string;
  line_total: string;
}

export interface EstimateSection {
  id: number;
  name: string;
  lines: EstimateLine[];
  section_total: string;
}

export interface ChecklistItem {
  id: number;
  section: string;
  label: string;
}

export interface PlanAnalyzeItem {
  section: string;
  label: string;
  qty: number;
}

export interface PlanAnalyzeResult {
  sheet_type: "electrical" | "architectural_only" | "mixed";
  confidence_note: string;
  items: PlanAnalyzeItem[];
}

export interface EstimateSummary {
  id: number;
  estimate_number: string;
  job_id: number | null;
  customer: string | null;
  status: "draft" | "sent" | "approved" | "declined";
  total: string;
  created_at: string;
  updated_at: string;
}

export interface Estimate {
  id: number;
  estimate_number: string;
  job_id: number | null;
  job_number: string | null;
  customer: string | null;
  address: string | null;
  customer_email: string | null;
  scope_of_work: string;
  exclusions: string | null;
  status: "draft" | "sent" | "approved" | "declined";
  profit_pct: string;
  discount_pct: string;
  material_total: string;
  labor_total: string;
  subtotal: string;
  profit_amount: string;
  discount_amount: string;
  total: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  sections: EstimateSection[];
  share_token: string | null;
  sent_at: string | null;
  responded_at: string | null;
}

export interface PublicEstimateLine {
  description: string;
  qty: string;
  unit: string;
  amount: string;
}

export interface PublicEstimateSection {
  name: string;
  lines: PublicEstimateLine[];
  section_total: string;
}

export interface PublicEstimate {
  estimate_number: string;
  customer: string | null;
  address: string | null;
  sections: PublicEstimateSection[];
  exclusions: string | null;
  total: string;
  status: "draft" | "sent" | "approved" | "declined";
  sent_at: string | null;
}

export interface JobFile {
  id: number;
  job_id: number;
  kind: "photo" | "document";
  filename: string;
  mime_type: string;
  data: string;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

// List view -- omits `data` (the base64 file content, which can be huge) so fetching a
// job's file list can't balloon memory on a job with many/large files. Fetch a single
// file's data on demand via GET /jobs/files/{id} (see JobFile above).
export interface JobFileMeta {
  id: number;
  job_id: number;
  kind: "photo" | "document";
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export const EXPENSE_CATEGORIES = [
  "fuel", "tools_equipment", "permits_fees", "subcontractor", "office_admin", "insurance", "travel", "misc",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fuel: "Fuel",
  tools_equipment: "Tools & Equipment",
  permits_fees: "Permits & Fees",
  subcontractor: "Subcontractor",
  office_admin: "Office / Admin",
  insurance: "Insurance",
  travel: "Travel",
  misc: "Misc",
};

export interface Expense {
  id: number;
  expense_date: string;
  amount: string;
  category: ExpenseCategory;
  job_id: number | null;
  job_number: string | null;
  notes: string | null;
  receipt_filename?: string | null;
  receipt_mime_type?: string | null;
  receipt_data?: string | null; // only present on the single-expense GET
  has_receipt?: boolean; // only present on list views
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRevenue {
  id: number;
  job_id: number;
  received_date: string;
  amount: string;
  kind: "deposit" | "progress" | "final" | "other";
  ref: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MissingRateUser {
  user_id: number;
  user_name: string;
  hours: number;
}

export interface JobCostingOut {
  job: Job;
  material_cost: string;
  labor_cost: string;
  labor_hours: number;
  expense_cost: string;
  revenue: string;
  profit: string;
  revenue_lines: JobRevenue[];
  expense_lines: Expense[];
  missing_rate_users: MissingRateUser[];
}

export interface PnlJobRow {
  job_id: number;
  job_number: string;
  job_name: string;
  revenue: string;
  material_cost: string;
  labor_cost: string;
  expense_cost: string;
  profit: string;
}

export interface PnlOut {
  revenue: string;
  material_cost: string;
  labor_cost: string;
  expense_cost: string;
  overhead_expenses: string;
  profit: string;
  by_job: PnlJobRow[];
  missing_rate_users: MissingRateUser[];
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: string; label: string }
  | { type: "tool_end"; tool: string }
  | { type: "done" }
  | { type: "error"; message: string };
