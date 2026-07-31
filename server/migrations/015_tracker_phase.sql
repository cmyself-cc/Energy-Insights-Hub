ALTER TABLE tracker_runs ADD COLUMN phase TEXT DEFAULT '';
ALTER TABLE tracker_runs ADD COLUMN phase_progress INTEGER DEFAULT 0;
