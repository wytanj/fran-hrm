-- 018 — Contractor employment type, alongside full_time and part_time.
alter type public.employment_type add value if not exists 'contractor';
