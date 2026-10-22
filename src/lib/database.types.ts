// Hand-written to match supabase/migrations (phase 1 + phase 2). Regenerate with `supabase gen types` once the CLI is linked.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type ApplianceLine = { name: string; side: string | null }

type CampRosterRow = {
  id: string
  reg_no: string | null
  serial_no: number | null
  batch: number | null
  name: string
  aadhaar_no: string | null
  dob?: string | null
  yob?: number | null
  appliances: Json
  review_note: string | null
  attended_at: string | null
  attended_by: string | null
  distributed_at: string | null
  distributed_by: string | null
  photo_path: string | null
  submission_id: string | null
  created_at: string
  updated_at: string
}

type BeneficiaryRow = {
  id: string
  aadhaar_no: string | null
  aadhaar_name: string | null
  gender: string | null
  dob: string | null
  yob: number | null
  care_of: string | null
  address: string | null
  pincode: string | null
  district: string | null
  state: string | null
  vid: string | null
  phone: string | null
  email: string | null
  udid_no: string | null
  udid_label: string | null
  disability_type: string | null
  disability_pct: number | null
  source: 'excel' | 'registered'
  created_at: string
  updated_at: string
}

export type Database = {
  public: {
    Tables: {
      beneficiaries: {
        Row: BeneficiaryRow
        // name is NOT NULL without default; staff may insert only source = 'registered' (RLS)
        Insert: Partial<Omit<BeneficiaryRow, 'name'>> & { name: string }
        Update: Partial<BeneficiaryRow>
        Relationships: []
      }
      camp_roster: {
        Row: CampRosterRow
        // Rows are seeded by SQL; the app has no insert/delete policy.
        Insert: Partial<Omit<CampRosterRow, 'name'>> & { name: string }
        // The app may only update these columns (column-level grant).
        Update: Partial<
          Pick<
            CampRosterRow,
            'attended_at' | 'attended_by' | 'distributed_at' | 'distributed_by' | 'photo_path' | 'submission_id'
          >
        >
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      mark_attendance: {
        Args: { p_id: string; p_dob?: string | null }
        Returns: CampRosterRow
      }
      link_aadhaar: {
        Args: { p_roster_id: string; p_aadhaar: string; p_dob: string | null; p_yob: number | null }
        Returns: CampRosterRow
      }
      complete_distribution: {
        Args: { p_id: string; p_photo_path: string; p_submission_id: string }
        Returns: CampRosterRow
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
