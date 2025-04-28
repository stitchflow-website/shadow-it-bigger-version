-- Add a unique constraint to the user_applications table to prevent duplicate relationships
ALTER TABLE user_applications
  ADD CONSTRAINT user_application_unique_relationship UNIQUE (user_id, application_id); 