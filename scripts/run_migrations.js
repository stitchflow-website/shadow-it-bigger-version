#!/usr/bin/env node

/**
 * Script to run database migrations
 * Usage: node run_migrations.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: Missing Supabase environment variables');
  console.error('Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Function to run migrations
async function runMigrations() {
  try {
    console.log('Starting database migrations...');
    
    // Get all migration files
    const migrationsDir = path.join(__dirname, '..', 'lib', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort to ensure migrations run in order
    
    console.log(`Found ${migrationFiles.length} migration files`);
    
    // Create migrations table if it doesn't exist
    const { error: tableError } = await supabase.rpc('create_migrations_table_if_not_exists');
    
    if (tableError) {
      console.error('Error creating migrations table:', tableError);
      // Try direct SQL if RPC fails
      const { error: sqlError } = await supabase.from('_migrations')
        .select('name')
        .limit(1);
      
      if (sqlError && sqlError.code === '42P01') {
        // Table doesn't exist, create it
        const { error: createError } = await supabase.rpc('execute_sql', {
          sql: `
            CREATE TABLE IF NOT EXISTS _migrations (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              applied_at TIMESTAMPTZ DEFAULT NOW()
            );
          `
        });
        
        if (createError) {
          console.error('Failed to create migrations table:', createError);
          process.exit(1);
        }
      }
    }
    
    // Get already applied migrations
    const { data: appliedMigrations, error: fetchError } = await supabase
      .from('_migrations')
      .select('name');
    
    if (fetchError) {
      console.error('Error fetching applied migrations:', fetchError);
      process.exit(1);
    }
    
    const appliedSet = new Set(appliedMigrations?.map(m => m.name) || []);
    
    // Run each migration that hasn't been applied yet
    for (const file of migrationFiles) {
      if (appliedSet.has(file)) {
        console.log(`Migration ${file} already applied, skipping`);
        continue;
      }
      
      console.log(`Applying migration: ${file}`);
      const migrationPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(migrationPath, 'utf8');
      
      // Execute the migration
      const { error: migrationError } = await supabase.rpc('execute_sql', { sql });
      
      if (migrationError) {
        console.error(`Error applying migration ${file}:`, migrationError);
        process.exit(1);
      }
      
      // Record the migration
      const { error: recordError } = await supabase
        .from('_migrations')
        .insert({ name: file });
      
      if (recordError) {
        console.error(`Error recording migration ${file}:`, recordError);
        process.exit(1);
      }
      
      console.log(`Successfully applied migration: ${file}`);
    }
    
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Unexpected error during migrations:', error);
    process.exit(1);
  }
}

// Run migrations
runMigrations()
  .then(() => {
    console.log('Migration script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  }); 