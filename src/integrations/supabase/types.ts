export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      auto_send_log: {
        Row: {
          flight_date: string
          flights_count: number
          message_id: string | null
          note: string | null
          recipient: string | null
          sent_at: string
        }
        Insert: {
          flight_date: string
          flights_count?: number
          message_id?: string | null
          note?: string | null
          recipient?: string | null
          sent_at?: string
        }
        Update: {
          flight_date?: string
          flights_count?: number
          message_id?: string | null
          note?: string | null
          recipient?: string | null
          sent_at?: string
        }
        Relationships: []
      }
      clock_offsets: {
        Row: {
          flight_date: string
          offset_seconds: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          flight_date: string
          offset_seconds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          flight_date?: string
          offset_seconds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      clock_settings: {
        Row: {
          caravan_can_edit: boolean
          id: number
          ogn_sync_interval_seconds: number
          permanent_offset_seconds: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          caravan_can_edit?: boolean
          id?: number
          ogn_sync_interval_seconds?: number
          permanent_offset_seconds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          caravan_can_edit?: boolean
          id?: number
          ogn_sync_interval_seconds?: number
          permanent_offset_seconds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      club_members: {
        Row: {
          created_at: string
          created_by: string | null
          currency_aerotow_override: string | null
          currency_winch_override: string | null
          full_name: string
          id: string
          membership_number: string
          under_21: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency_aerotow_override?: string | null
          currency_winch_override?: string | null
          full_name: string
          id?: string
          membership_number: string
          under_21?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency_aerotow_override?: string | null
          currency_winch_override?: string | null
          full_name?: string
          id?: string
          membership_number?: string
          under_21?: boolean
        }
        Relationships: []
      }
      cng_settings: {
        Row: {
          enabled: boolean
          id: number
          last_sync_at: string | null
          last_sync_error: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: number
          last_sync_at?: string | null
          last_sync_error?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: number
          last_sync_at?: string | null
          last_sync_error?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      daily_gfes: {
        Row: {
          checked: boolean
          checked_at: string | null
          created_at: string
          flight_date: string
          gfe_type: string | null
          id: string
          notes: string | null
          passenger_name: string | null
          phone: string | null
          position: number
          raw_text: string
          ref: string | null
          source: string
          time_text: string | null
        }
        Insert: {
          checked?: boolean
          checked_at?: string | null
          created_at?: string
          flight_date: string
          gfe_type?: string | null
          id?: string
          notes?: string | null
          passenger_name?: string | null
          phone?: string | null
          position: number
          raw_text: string
          ref?: string | null
          source?: string
          time_text?: string | null
        }
        Update: {
          checked?: boolean
          checked_at?: string | null
          created_at?: string
          flight_date?: string
          gfe_type?: string | null
          id?: string
          notes?: string | null
          passenger_name?: string | null
          phone?: string | null
          position?: number
          raw_text?: string
          ref?: string | null
          source?: string
          time_text?: string | null
        }
        Relationships: []
      }
      daily_logs: {
        Row: {
          cng_raw: Json | null
          cng_synced_at: string | null
          created_at: string
          created_by: string | null
          duty_instructor: string | null
          duty_pilot: string | null
          flight_date: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          cng_raw?: Json | null
          cng_synced_at?: string | null
          created_at?: string
          created_by?: string | null
          duty_instructor?: string | null
          duty_pilot?: string | null
          flight_date: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          cng_raw?: Json | null
          cng_synced_at?: string | null
          created_at?: string
          created_by?: string | null
          duty_instructor?: string | null
          duty_pilot?: string | null
          flight_date?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          body_template: string
          cc_email: string
          enabled: boolean
          from_email: string
          id: number
          subject_template: string
          to_email: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body_template?: string
          cc_email?: string
          enabled?: boolean
          from_email?: string
          id?: number
          subject_template?: string
          to_email?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body_template?: string
          cc_email?: string
          enabled?: boolean
          from_email?: string
          id?: number
          subject_template?: string
          to_email?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      fleet_gliders: {
        Row: {
          callsign: string | null
          created_at: string
          flarm_id: string | null
          glider_type: string | null
          id: string
          registration: string
        }
        Insert: {
          callsign?: string | null
          created_at?: string
          flarm_id?: string | null
          glider_type?: string | null
          id?: string
          registration: string
        }
        Update: {
          callsign?: string | null
          created_at?: string
          flarm_id?: string | null
          glider_type?: string | null
          id?: string
          registration?: string
        }
        Relationships: []
      }
      flight_audit: {
        Row: {
          action: string
          after_row: Json | null
          before_row: Json | null
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          changed_fields: string[] | null
          flight_date: string | null
          flight_id: string
          glider_registration: string | null
          id: number
        }
        Insert: {
          action: string
          after_row?: Json | null
          before_row?: Json | null
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          changed_fields?: string[] | null
          flight_date?: string | null
          flight_id: string
          glider_registration?: string | null
          id?: number
        }
        Update: {
          action?: string
          after_row?: Json | null
          before_row?: Json | null
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          changed_fields?: string[] | null
          flight_date?: string | null
          flight_id?: string
          glider_registration?: string | null
          id?: number
        }
        Relationships: []
      }
      flight_tombstones: {
        Row: {
          created_at: string
          created_by: string | null
          flarm_id: string | null
          flight_date: string
          glider_registration: string | null
          id: string
          landing_time: string | null
          takeoff_time: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          flarm_id?: string | null
          flight_date: string
          glider_registration?: string | null
          id?: string
          landing_time?: string | null
          takeoff_time?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          flarm_id?: string | null
          flight_date?: string
          glider_registration?: string | null
          id?: string
          landing_time?: string | null
          takeoff_time?: string | null
        }
        Relationships: []
      }
      flights: {
        Row: {
          aerotow_height_ft: number | null
          created_at: string
          created_by: string | null
          flarm_id: string | null
          flight_date: string
          glider_id: string | null
          glider_registration: string | null
          id: string
          landing_time: string | null
          launch_type: Database["public"]["Enums"]["launch_type"] | null
          logged_by: string | null
          manual: boolean
          notes: string | null
          ogn_source: Json | null
          p1_charge: boolean
          p1_kind: string | null
          p1_membership: string | null
          p1_name: string | null
          p2_charge: boolean
          p2_kind: string | null
          p2_membership: string | null
          p2_name: string | null
          takeoff_time: string | null
          under_21: boolean | null
          updated_at: string
        }
        Insert: {
          aerotow_height_ft?: number | null
          created_at?: string
          created_by?: string | null
          flarm_id?: string | null
          flight_date?: string
          glider_id?: string | null
          glider_registration?: string | null
          id?: string
          landing_time?: string | null
          launch_type?: Database["public"]["Enums"]["launch_type"] | null
          logged_by?: string | null
          manual?: boolean
          notes?: string | null
          ogn_source?: Json | null
          p1_charge?: boolean
          p1_kind?: string | null
          p1_membership?: string | null
          p1_name?: string | null
          p2_charge?: boolean
          p2_kind?: string | null
          p2_membership?: string | null
          p2_name?: string | null
          takeoff_time?: string | null
          under_21?: boolean | null
          updated_at?: string
        }
        Update: {
          aerotow_height_ft?: number | null
          created_at?: string
          created_by?: string | null
          flarm_id?: string | null
          flight_date?: string
          glider_id?: string | null
          glider_registration?: string | null
          id?: string
          landing_time?: string | null
          launch_type?: Database["public"]["Enums"]["launch_type"] | null
          logged_by?: string | null
          manual?: boolean
          notes?: string | null
          ogn_source?: Json | null
          p1_charge?: boolean
          p1_kind?: string | null
          p1_membership?: string | null
          p1_name?: string | null
          p2_charge?: boolean
          p2_kind?: string | null
          p2_membership?: string | null
          p2_name?: string | null
          takeoff_time?: string | null
          under_21?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flights_glider_id_fkey"
            columns: ["glider_id"]
            isOneToOne: false
            referencedRelation: "fleet_gliders"
            referencedColumns: ["id"]
          },
        ]
      }
      help_content: {
        Row: {
          body: string
          checklist_enabled: boolean
          checklist_items: Json
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body?: string
          checklist_enabled?: boolean
          checklist_items?: Json
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          checklist_enabled?: boolean
          checklist_items?: Json
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      notams: {
        Row: {
          centre_lat: number
          centre_lon: number
          created_at: string
          description: string
          id: string
          kind: string
          lower_ft: number | null
          notam_ref: string
          polygon: Json | null
          radius_nm: number | null
          raw: string | null
          source: string
          updated_at: string
          upper_ft: number | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          centre_lat: number
          centre_lon: number
          created_at?: string
          description?: string
          id?: string
          kind?: string
          lower_ft?: number | null
          notam_ref: string
          polygon?: Json | null
          radius_nm?: number | null
          raw?: string | null
          source?: string
          updated_at?: string
          upper_ft?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          centre_lat?: number
          centre_lon?: number
          created_at?: string
          description?: string
          id?: string
          kind?: string
          lower_ft?: number | null
          notam_ref?: string
          polygon?: Json | null
          radius_nm?: number | null
          raw?: string | null
          source?: string
          updated_at?: string
          upper_ft?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string
          notify_own_fleet: boolean
          notify_proximity: boolean
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string
          notify_own_fleet?: boolean
          notify_proximity?: boolean
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          notify_own_fleet?: boolean
          notify_proximity?: boolean
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      caravan_offset_editing_allowed: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_caravan: { Args: never; Returns: boolean }
      is_office: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user" | "office"
      launch_type: "aerotow" | "winch"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "office"],
      launch_type: ["aerotow", "winch"],
    },
  },
} as const
