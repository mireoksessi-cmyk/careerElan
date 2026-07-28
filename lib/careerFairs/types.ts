import type { CareerEventType, EventTypeConfidence } from "./eventType";

export type { CareerEventType, EventTypeConfidence };

export type EventMode = "in_person" | "online" | "hybrid";

export type CareerFairStatus = "active" | "expired" | "removed";

export type CareerFairAudience =
  | "public"
  | "students_only"
  | "alumni"
  | "newcomers"
  | "employer_invite_only"
  | "unknown";

export type CareerFair = {
  id: string;
  title: string;
  organizer: string | null;
  description: string | null;
  start_at: string;
  end_at: string | null;
  timezone: string | null;
  city: string | null;
  province_or_territory: string | null;
  country: string;
  venue: string | null;
  event_mode: EventMode;
  official_url: string;
  registration_url: string | null;
  source_name: string;
  source_event_id: string;
  last_verified_at: string;
  status: CareerFairStatus;
  institution: string | null;
  source_category: string | null;
  audience: CareerFairAudience | null;
  eligibility_text: string | null;
  registration_required: boolean | null;
  cost_type: "free" | "paid" | null;
  event_type: CareerEventType | null;
  event_type_confidence: EventTypeConfidence | null;
};

export type MatchTier = "city" | "metro" | "province" | "nearby" | "canada";

export type RecommendedCareerFair = CareerFair & {
  matchTier: MatchTier;
};
