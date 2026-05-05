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
      club_members: {
        Row: {
          created_at: string
          created_by: string | null
          full_name: string
          id: string
          membership_number: string
          under_21: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          full_name: string
          id?: string
          membership_number: string
          under_21?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          full_name?: string
          id?: string
          membership_number?: string
          under_21?: boolean
        }
        Relationships: []
      }
      daily_logs: {
        Row: {
          created_at: string
          created_by: string | null
          duty_instructor: string | null
          duty_pilot: string | null
          flight_date: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duty_instructor?: string | null
          duty_pilot?: string | null
          flight_date: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_office: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
      launch_type: ["aerotow", "winch"],
    },
  },
} as const
