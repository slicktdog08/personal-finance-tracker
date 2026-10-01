// Serializable DTOs for bill mutations (importable by client + server).

export interface InstancePatch {
  name?: string;
  amount?: number | null;
  status?: string;
  dueDay?: number | null;
  paymentType?: string | null;
  isDebt?: boolean;
  isCancel?: boolean;
  sortOrder?: number;
}
