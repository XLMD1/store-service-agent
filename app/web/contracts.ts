/** Frontend-only demo contracts, aligned with current Python inventory schemas.
 * UUID/date/time are strings at transport boundaries; runtime validation remains required.
 * These declarations do not claim that the existing JavaScript is statically checked.
 */
export type UUID = string;
export type ISODate = string;
export type AwareDatetime = string;
export type Scenario = 'normal' | 'empty' | 'error' | 'conflict' | 'pending';
export type Role = 'owner' | 'clerk' | 'technician' | 'stock_operator';
export type Permission = 'service.read' | 'service.draft' | 'service.confirm' | 'repair.query' | 'knowledge.review' | 'knowledge.publish' | 'inventory.read' | 'inventory.inbound' | 'inventory.outbound' | 'inventory.opening' | 'inventory.correct' | 'reservation.confirm' | 'reservation.cancel' | 'reservation.pickup' | 'catalog.manage' | 'account.manage';
export interface Identity { id: UUID; username: string; roles: Role[]; permissions: Permission[]; enabled: boolean }
export interface Warehouse { id: UUID; name: string; code: string; enabled: boolean; version: number }
export interface ProductModel { id: UUID; name: string; aliases: string[]; enabled: boolean; version: number }
export interface WarehouseRef { id: UUID; name: string; code?: string; enabled?: boolean }
export interface ModelRef { id: UUID; name: string; enabled?: boolean }
export interface CustomerRef { id: UUID; display_name: string; phone: string | null; address: string | null }
export interface Customer { id: UUID; display_name: string; phone: string | null; address: string | null; version: number }
export type Occurred =
  | { precision: 'date'; date: ISODate | null; at?: null; t0_relation?: 'after' | 'at_or_before' | 'unknown' | null; boundary_note?: string }
  | { precision: 'datetime'; at: AwareDatetime | null; date?: null; t0_relation?: never; boundary_note?: never };
export interface OpeningReservation { customer_id: UUID; remaining_quantity: number; basis_note: string }
export interface OpeningParameters { warehouse_id: UUID | null; model_id: UUID | null; t0: AwareDatetime | null; on_hand: number | null; opening_reservations: OpeningReservation[]; basis_note: string }
export interface StockParameters { warehouse_id: UUID | null; model_id: UUID | null; quantity: number | null; occurred: Occurred | null; basis_note: string }
export interface ReserveParameters extends StockParameters { customer_id: UUID | null; basis_kind: 'oral' | 'deposit' | 'paid' | null }
export interface ReservationActionParameters { reservation_id: UUID | null; quantity: number | null; occurred: Occurred | null; basis_note: string }
export interface AdjustmentParameters { warehouse_id: UUID | null; model_id: UUID | null; on_hand: number | null; occurred: Occurred | null; basis_note: string }
export interface CorrectionParameters { document_id: UUID | null; new_quantity: number | null; basis_note: string }
export interface ParametersByKind {
  inventory_opening: OpeningParameters;
  inventory_inbound: StockParameters;
  inventory_outbound: StockParameters;
  reservation_create: ReserveParameters;
  reservation_pickup: ReservationActionParameters;
  reservation_cancel: ReservationActionParameters;
  inventory_adjustment: AdjustmentParameters;
  inventory_correction: CorrectionParameters;
}
export type BusinessKind = keyof ParametersByKind;
export type DraftCreate = { [K in BusinessKind]: { kind: K; parameters: ParametersByKind[K] } }[BusinessKind];
export interface Quantities { on_hand: number; reserved: number; available: number }
export interface NullableQuantities { on_hand: number | null; reserved: number | null; available: number | null }
export interface Reservation { id: UUID; account_id: UUID; customer_id: UUID; customer: CustomerRef; registered_quantity: number; picked_quantity: number; cancelled_quantity: number; remaining_quantity: number; is_opening: boolean; status: 'active' | 'ended'; basis_kind: 'oral' | 'deposit' | 'paid' | null; basis_note: string; version: number }
export interface ReservationListItem extends Reservation { warehouse: WarehouseRef; model: ModelRef; t0: AwareDatetime }
export type Balance = {warehouse: WarehouseRef; model: ModelRef; queried_at: AwareDatetime; reservations: Reservation[]} & (
  | (Quantities & {status: 'opened'; t0: AwareDatetime; version: number})
  | {status: 'uninitialized'; on_hand: null; reserved: null; available: null; t0: null; version: null}
);
export interface ImpactPreview extends Quantities { warehouse: WarehouseRef; model: ModelRef; before: Quantities; after: Quantities; quantity: number; customer?: CustomerRef; reservation: Reservation | null; original_document: InventoryDocument | null; on_hand_delta: number; reserved_delta: number }
export interface TargetVersions { warehouse?: number; model?: number; account?: number | null; reservation?: number; document?: number }
export type Draft<K extends BusinessKind = BusinessKind> = K extends BusinessKind ? {
  id: UUID; kind: K; parameters: ParametersByKind[K]; version: number; target_versions: TargetVersions; updated_at?: string;
} & (
  | {state: 'missing'; preview: null; missing_fields: string[]; operation_id: null}
  | {state: 'ready' | 'succeeded'; preview: ImpactPreview | Quantities; missing_fields: []; operation_id: UUID}
) : never;
export interface DraftUpdate<K extends BusinessKind> { expected_version: number; parameters: ParametersByKind[K] }
export interface Confirmation<K extends BusinessKind = BusinessKind> { draft_id: UUID; draft_version: number; parameters: ParametersByKind[K] }
export interface Receipt { demo: true; draft_id: UUID; draft_version: number; account_id: UUID; opening_reserved?: number; delta?: number; old_quantity?: number; new_quantity?: number; kind: BusinessKind; business_id: UUID; operation_id: UUID; ledger_ids: UUID[]; actor_id: UUID; quantity: number; occurred: Occurred; registered_at: AwareDatetime; t0: AwareDatetime; balance: Balance; reservation: Reservation | null; original_document_id: UUID | null }
export type Operation = {id: UUID} & ({state: 'pending' | 'invalidated'; result: null} | {state: 'succeeded'; result: Receipt});
export type LedgerKind = 'opening' | 'inbound' | 'outbound' | 'reserve' | 'cancel' | 'pickup' | 'adjustment' | 'correction';
export interface CorrectionRevision { id: UUID; old_quantity: number; new_quantity: number; registered_at: AwareDatetime; basis_note: string }
export interface InventoryDocument { id: UUID; warehouse: WarehouseRef; model: ModelRef; kind: LedgerKind; original_quantity: number; effective_quantity: number; version: number; reservation_id: UUID | null; occurred: Occurred; registered_at: AwareDatetime; basis_note: string; corrections: CorrectionRevision[] }
export interface LedgerRow { id: UUID; business_id: UUID; operation_id: UUID; original_document_id: UUID | null; old_quantity: number | null; new_quantity: number | null; kind: LedgerKind; quantity: number; on_hand_delta: number; reserved_delta: number; version: number; reservation_id: UUID | null; occurred: Occurred; registered_at: AwareDatetime; actor_id: UUID; actor_name: string; basis_note: string }
export interface Overview { warehouse: WarehouseRef; queried_at: AwareDatetime; items: Array<NullableQuantities & { model: ModelRef; status: 'opened' | 'uninitialized'; t0: AwareDatetime | null; version: number | null }>; totals: NullableQuantities & {opened_model_count: number; uninitialized_model_count: number} }
export interface Coverage { warehouse: WarehouseRef; model: ModelRef; status: 'opened' | 'uninitialized'; t0: AwareDatetime | null; coverage_status: 'uninitialized' | 'before_t0' | 'future' | 'partial' | 'covered' }
export interface Statistics { start: ISODate; end: ISODate; group_by: 'date' | 'warehouse' | 'model'; total_quantity: number; groups: Array<{key: string; label: string; quantity: number}>; documents: InventoryDocument[]; coverage: Coverage[]; queried_at: AwareDatetime }
export interface ReconciliationItem extends NullableQuantities { warehouse: WarehouseRef; model: ModelRef; status: 'opened' | 'uninitialized'; consistent: boolean | null; ledger_on_hand: number | null; ledger_reserved: number | null; reservation_remaining: number | null; documents_on_hand: number | null; documents_reserved: number | null }
export interface Reconciliation { items: ReconciliationItem[]; consistent: boolean | null; queried_at: AwareDatetime }
export interface MockError extends Error { status: number }
export interface GetResponses {
  '/auth/me': Identity;
  '/auth/csrf': {csrf_token: string};
  '/catalog/warehouses': Warehouse[];
  '/catalog/models': ProductModel[];
  '/catalog/customers': Customer[];
  '/drafts': Draft[];
  '/inventory/overview': Overview;
  '/inventory/balance': Balance;
  '/inventory/reservations': ReservationListItem[];
  '/inventory/ledger': LedgerRow[];
  '/inventory/documents': InventoryDocument[];
  '/inventory/statistics': Statistics;
  '/inventory/reconciliation': Reconciliation;
}
export type GetPath = keyof GetResponses | `${keyof GetResponses}?${string}` | `/drafts/${UUID}` | `/operations/${UUID}`;
export type GetResponse<P extends string> = P extends `${infer Base}?${string}` ? GetResponse<Base> : P extends keyof GetResponses ? GetResponses[P] : P extends `/drafts/${string}` ? Draft : P extends `/operations/${string}` ? Operation : never;
export interface MockAPI {
  request<P extends GetPath>(path: P, method?: 'GET'): Promise<GetResponse<P>>;
  request(path: '/auth/login', method: 'POST', body: {username: string; password: 'demo' | '演示'}): Promise<Identity>;
  request(path: '/auth/logout', method: 'POST'): Promise<{demo: true}>;
  request(path: '/drafts', method: 'POST', body: DraftCreate): Promise<Draft>;
  request<K extends BusinessKind>(path: `/drafts/${UUID}`, method: 'PATCH', body: DraftUpdate<K>): Promise<Draft<K>>;
  request(path: `/operations/${UUID}/confirm`, method: 'POST', body: Confirmation): Promise<Receipt>;
  request(path: '/catalog/warehouses', method: 'POST', body: {confirmed: true; name: string; code?: string}): Promise<Warehouse>;
  request(path: '/catalog/models', method: 'POST', body: {confirmed: true; name: string; aliases?: string[]}): Promise<ProductModel>;
  request(path: '/catalog/customers', method: 'POST', body: {confirmed: true; display_name: string; phone?: string | null; address?: string | null}): Promise<Customer>;
  request(path: `/catalog/warehouses/${UUID}`, method: 'PATCH', body: {confirmed: true; expected_version: number; name?: string; code?: string; enabled?: boolean}): Promise<Warehouse>;
  request(path: `/catalog/models/${UUID}`, method: 'PATCH', body: {confirmed: true; expected_version: number; name?: string; aliases?: string[]; enabled?: boolean}): Promise<ProductModel>;
  reset(): {scenario: Scenario; demo: true};
  setScenario(scenario: Scenario): {scenario: Scenario; demo: true};
  getScenario(): Scenario;
}
