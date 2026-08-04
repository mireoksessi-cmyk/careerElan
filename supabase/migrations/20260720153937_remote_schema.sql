


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."get_email_by_login_id"("input_login_id" "text") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select email
  from public.profiles
  where login_id = input_login_id
  limit 1;
$$;


ALTER FUNCTION "public"."get_email_by_login_id"("input_login_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (
    id,
    full_name,
    phone,
    login_id,
    email,
    created_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    lower(
      coalesce(
        new.raw_user_meta_data ->> 'login_id',
        split_part(new.email, '@', 1)
      )
    ),
    lower(coalesce(new.email, '')),
    now()
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    phone = excluded.phone,
    login_id = excluded.login_id,
    email = excluded.email;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."analytics_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "summary" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."analytics_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "company" "text",
    "job_title" "text",
    "status" "text",
    "applied_date" "date",
    "interview_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "job_url" "text",
    "location" "text",
    "job_type" "text",
    "resume_id" "uuid",
    "cover_letter_id" "uuid",
    "resume_text" "text",
    "cover_letter_text" "text",
    "email_draft" "text",
    "job_analysis" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "followup_email_count" integer DEFAULT 0 NOT NULL,
    "last_followup_email_at" integer DEFAULT 0 NOT NULL,
    "ai_score" bigint,
    "ai_interview" "text",
    "ai_matched" "jsonb",
    "ai_missing" "jsonb",
    "ai_advice" "text",
    "ai_insight" "jsonb",
    "job_description" "text"
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."career_memory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "email" "text",
    "phone" "text",
    "location" "text",
    "summary" "text",
    "target_roles" "text"[],
    "skills" "text"[],
    "languages" "jsonb",
    "education" "jsonb",
    "experience" "jsonb",
    "certifications" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "career_goal_summary" "text",
    "linkedin" "text",
    "headline" "text",
    "target_industry" "text",
    "target_location" "text",
    "salary_expectation" "text",
    "projects" "jsonb",
    "resume_template" "text",
    "cover_template" "text",
    "theme" "text",
    "font" "text",
    "text_size" "text",
    "tone" "text",
    "profile_strength" integer DEFAULT 0,
    "required_completed" boolean DEFAULT false,
    "resume_name" "text",
    "selected_resume_type" "text",
    "selected_resume_id" "uuid",
    "selected_cover_letter_id" "uuid",
    "volunteer_experience" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."career_memory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cover_letters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "file_name" "text",
    "storage_path" "text",
    "original_text" "text",
    "parsed_data" "jsonb",
    "is_default" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cover_letters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "plan" "text" DEFAULT 'free'::"text",
    "package_limit" integer DEFAULT 50,
    "package_used" integer DEFAULT 0,
    "resume_count" integer DEFAULT 0,
    "cover_letter_count" integer DEFAULT 0,
    "ai_usage" integer DEFAULT 0,
    "onboarding_complete" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "login_id" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "country" "text",
    "timezone" "text",
    "email_notifications" boolean DEFAULT true,
    "marketing_notifications" boolean DEFAULT false
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resumes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "file_name" "text",
    "storage_path" "text",
    "original_text" "text",
    "parsed_data" "jsonb",
    "is_default" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "source_type" "text" DEFAULT 'uploaded'::"text"
);


ALTER TABLE "public"."resumes" OWNER TO "postgres";


ALTER TABLE ONLY "public"."analytics_cache"
    ADD CONSTRAINT "analytics_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_cache"
    ADD CONSTRAINT "analytics_cache_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."career_memory"
    ADD CONSTRAINT "career_memory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."career_memory"
    ADD CONSTRAINT "career_memory_user_unique" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."cover_letters"
    ADD CONSTRAINT "cover_letters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_login_id_key" UNIQUE ("login_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resumes"
    ADD CONSTRAINT "resumes_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "profiles_login_id_unique" ON "public"."profiles" USING "btree" ("lower"("login_id")) WHERE ("login_id" IS NOT NULL);



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."career_memory"
    ADD CONSTRAINT "career_memory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cover_letters"
    ADD CONSTRAINT "cover_letters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resumes"
    ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."analytics_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "application_delete" ON "public"."applications" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "application_insert" ON "public"."applications" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "application_select" ON "public"."applications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "application_update" ON "public"."applications" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."career_memory" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "career_memory_delete" ON "public"."career_memory" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "career_memory_insert" ON "public"."career_memory" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "career_memory_select" ON "public"."career_memory" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "career_memory_update" ON "public"."career_memory" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cover_letter_delete" ON "public"."cover_letters" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cover_letter_insert" ON "public"."cover_letters" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "cover_letter_select" ON "public"."cover_letters" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cover_letter_update" ON "public"."cover_letters" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."cover_letters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profile_delete" ON "public"."profiles" FOR DELETE USING (("auth"."uid"() = "id"));



CREATE POLICY "profile_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "profile_select" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "profile_update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "resume_delete" ON "public"."resumes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "resume_insert" ON "public"."resumes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "resume_select" ON "public"."resumes" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "resume_update" ON "public"."resumes" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."resumes" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."get_email_by_login_id"("input_login_id" "text") FROM PUBLIC;


















GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."analytics_cache" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."analytics_cache" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."analytics_cache" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."applications" TO "anon";
GRANT ALL ON TABLE "public"."applications" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."applications" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."career_memory" TO "anon";
GRANT ALL ON TABLE "public"."career_memory" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."career_memory" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cover_letters" TO "anon";
GRANT ALL ON TABLE "public"."cover_letters" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cover_letters" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."resumes" TO "anon";
GRANT ALL ON TABLE "public"."resumes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."resumes" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";



































CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "cover_storage_delete"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'cover-letters'::text));



  create policy "cover_storage_insert"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'cover-letters'::text));



  create policy "cover_storage_select"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'cover-letters'::text));



  create policy "cover_storage_update"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'cover-letters'::text))
with check ((bucket_id = 'cover-letters'::text));



  create policy "resume_storage_delete"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'resumes'::text));



  create policy "resume_storage_insert"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'resumes'::text));



  create policy "resume_storage_select"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'resumes'::text));



  create policy "resume_storage_update"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'resumes'::text))
with check ((bucket_id = 'resumes'::text));



