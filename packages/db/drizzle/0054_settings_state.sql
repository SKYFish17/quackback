-- Add state column to settings.
-- Trinary suspension state for cloud-billing safety: 'active' | 'suspended' | 'deleting'.
-- Self-hosters never set this (no config file → defaults to 'active'); the field
-- only matters for managed cloud where CP flips it via spec.config.state when a
-- subscription goes past-due or the Quackback is being deleted.
ALTER TABLE "settings"
  ADD COLUMN "state" text NOT NULL DEFAULT 'active';
