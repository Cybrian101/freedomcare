/** Types mirror supabase/migrations/*.sql column names exactly. */

export interface Appliance {
  name: string;
  /** "Lt" | "Rt" | "Bil" | "Uni" | "Adult" | "Child" | null */
  side: string | null;
}

/** public.camp_roster (phase 2: seeded Excel list + attendance + handover). Reg. No. is the token. */
export interface RosterRow {
  id: string;
  reg_no: string | null;
  serial_no: number | null;
  batch: number | null;
  name: string;
  aadhaar_no: string | null;
  /** yyyy-mm-dd; filled when an Aadhaar is linked or attendance is taken with a date of birth */
  dob?: string | null;
  yob?: number | null;
  appliances: Appliance[];
  review_note: string | null;
  attended_at: string | null;
  attended_by: string | null;
  distributed_at: string | null;
  distributed_by: string | null;
  photo_path: string | null;
  submission_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AadhaarFields {
  aadhaar_no: string | null;
  aadhaar_name: string | null;
  gender: string | null;
  dob: string | null; // yyyy-mm-dd
  yob: number | null;
  care_of: string | null;
  address: string | null;
  pincode: string | null;
  district: string | null;
  state: string | null;
  vid: string | null;
  phone: string | null;
  email: string | null;
}

export interface UdidFields {
  udid_no: string | null;
  udid_label: string | null;
  disability_type: string | null;
  disability_pct: number | null;
}

/** public.beneficiaries (phase 1: scan-registration test). */
export interface Beneficiary extends AadhaarFields, UdidFields {
  id: string;
  name: string;
  source: "excel" | "registered";
  created_at: string;
  updated_at: string;
}

/** Insert shape for beneficiaries (RLS requires source = 'registered'). */
export type BeneficiaryInsert = Partial<AadhaarFields & UdidFields> & {
  name: string;
  source?: "registered";
};

export interface OcrResult<T> {
  fields: T;
  /** 0-1 per field key. */
  confidence: Partial<Record<keyof T, number>>;
  warnings: string[];
  needsReview: boolean;
}
