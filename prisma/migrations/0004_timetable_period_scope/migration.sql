DROP INDEX IF EXISTS "timetable_entries_tenant_id_section_subject_id_day_of_week_period_no_key";

CREATE INDEX "timetable_entries_tenant_id_academic_year_id_term_id_section_subject_id_day_of_week_period_no_idx"
ON "timetable_entries"("tenant_id", "academic_year_id", "term_id", "section_subject_id", "day_of_week", "period_no");
