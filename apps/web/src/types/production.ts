// Production types for Recipes, Batches, Tanks, Yeast, and Fermentation

export type RecipePhase = 'mash' | 'boil' | 'fermentation' | 'conditioning' | 'packaging';
export type TankType = 'fermenter' | 'brite' | 'other';
export type CIPStatus = 'clean' | 'dirty' | 'in_progress' | 'required';
export type BatchStatus = 'planned' | 'brewing' | 'fermenting' | 'conditioning' | 'packaging' | 'completed' | 'archived' | 'cancelled';
export type CostMethod = 'actual_lots' | 'moving_avg' | 'latest';

export interface Recipe {
  id: string;
  workspace_id: string;
  name: string;
  recipe_code?: string;
  style?: string;
  target_volume?: number;
  target_og?: number;
  target_fg?: number;
  target_abv?: number;
  target_ibu?: number;
  target_srm?: number;
  efficiency_pct?: number;
  notes?: string;
  is_active: boolean;
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
  // Joined fields
  latest_version?: RecipeVersion;
  batch_count?: number;
  calculated_cost?: number;
  cost_breakdown?: any;
}

export interface RecipeVersion {
  id: string;
  workspace_id: string;
  recipe_id: string;
  version_number: number;
  name: string;
  target_volume?: number;
  target_og?: number;
  target_fg?: number;
  target_abv?: number;
  target_ibu?: number;
  target_srm?: number;
  target_ph?: number;
  efficiency_pct?: number;
  mash_steps?: any[];
  boil_time?: number;
  fermentation_steps?: any[];
  notes?: string;
  qa_specs?: any;
  overhead_pct?: number;
  // QA spec ranges
  og_min?: number;
  og_max?: number;
  fg_min?: number;
  fg_max?: number;
  abv_min?: number;
  abv_max?: number;
  ibu_min?: number;
  ibu_max?: number;
  srm_min?: number;
  srm_max?: number;
  ph_min?: number;
  ph_max?: number;
  // Cost fields
  calculated_cost?: number;
  cost_breakdown?: any;
  is_locked: boolean;
  is_active: boolean;
  created_at: string;
  created_by?: string;
  // Joined fields
  ingredients?: RecipeIngredient[];
  steps?: RecipeStep[];
}

export interface RecipeIngredient {
  id: string;
  workspace_id: string;
  recipe_version_id: string;
  item_id: string;
  qty: number;
  uom: string;
  phase: string;
  timing?: string;
  notes?: string;
  sort_order?: number;
  created_at: string;
  created_by?: string;
  // Joined fields
  item?: any; // Item type from inventory
  item_name?: string;
  unit_cost?: number;
}

export interface RecipeStep {
  id: string;
  workspace_id: string;
  recipe_version_id: string;
  step_number: number;
  phase: RecipePhase;
  name: string;
  description?: string;
  duration_minutes?: number;
  temperature?: number;
  temperature_unit?: string;
  notes?: string;
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
}

export interface Tank {
  id: string;
  workspace_id: string;
  name: string;
  type: TankType;
  capacity: number;
  current_batch_id?: string;
  cip_status: CIPStatus;
  last_cip_date?: string;
  location_id?: string;
  is_active: boolean;
  next_available_date?: string;
  cip_required_after_batches?: number;
  batches_since_cip?: number;
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
  // Joined fields
  current_batch?: Batch;
  location?: any;
}

export interface Batch {
  id: string;
  workspace_id: string;
  batch_number: string;
  recipe_version_id: string;
  status: BatchStatus;
  brew_date?: string;
  target_volume?: number;
  actual_volume?: number;
  target_og?: number;
  actual_og?: number;
  target_fg?: number;
  actual_fg?: number;
  actual_abv?: number;
  actual_ibu?: number;
  actual_ph?: number;
  tank_id?: string;
  yeast_batch_id?: string;
  owner_entity_id?: string;
  in_bond?: boolean;
  notes?: string;
  // Timeline fields
  ferment_start_date?: string;
  ferment_end_date?: string;
  conditioning_start_date?: string;
  conditioning_end_date?: string;
  package_date?: string;
  // Cost fields
  cogs_actual?: number;
  cogs_method?: CostMethod;
  inventory_consumed?: any;
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
  // Joined fields
  recipe_version?: RecipeVersion;
  tank?: Tank;
  yeast_batch?: YeastBatch;
  owner_entity?: any;
  ferm_readings?: FermReading[];
}

export interface YeastStrain {
  id: string;
  workspace_id: string;
  name: string;
  manufacturer?: string;
  strain_code?: string;
  type?: string;
  form?: string;
  attenuation_min?: number;
  attenuation_max?: number;
  temp_min?: number;
  temp_max?: number;
  flocculation?: string;
  recommended_max_generation?: number;
  notes?: string;
  is_active: boolean;
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
}

export interface YeastBatch {
  id: string;
  workspace_id: string;
  strain_id: string;
  generation: number;
  source_batch_id?: string;
  pitch_date?: string;
  harvest_date?: string;
  cell_count?: number;
  viability_pct?: number;
  volume?: number;
  storage_location?: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
  // Joined fields
  strain?: YeastStrain;
  source_batch?: YeastBatch;
}

export interface FermReading {
  id: string;
  workspace_id: string;
  batch_id: string;
  reading_at: string;
  sg?: number;
  temp?: number;
  ph?: number;
  pressure?: number;
  notes?: string;
  created_at: string;
  created_by?: string;
}

export interface BatchYeastLink {
  id: string;
  workspace_id: string;
  batch_id: string;
  yeast_batch_id: string;
  role: 'pitched' | 'harvested_from';
  pitch_rate?: number;
  created_at: string;
  created_by?: string;
}

export interface OwnershipEntity {
  id: string;
  workspace_id: string;
  name: string;
  ttb_permit_number?: string;
  address?: string;
  contact_email?: string;
  contact_phone?: string;
  is_self?: boolean;
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
}

// View types
export interface BatchTimeline extends Batch {
  recipe_name?: string;
  tank_name?: string;
  yeast_strain?: string;
  yeast_generation?: number;
  days_in_fermentation?: number;
  days_in_conditioning?: number;
  reading_count?: number;
  last_reading_at?: string;
}

export interface TankStatus extends Tank {
  current_batch_number?: string;
  current_batch_status?: BatchStatus;
  current_batch_brew_date?: string;
  cip_status_text?: 'Required' | 'Soon' | 'OK';
  is_available?: boolean;
}

export interface YeastInventory extends YeastBatch {
  strain_name?: string;
  strain_type?: string;
  recommended_max_generation?: number;
  generation_status?: 'Max generation reached' | 'Near max generation' | 'OK';
  is_available?: boolean;
  age?: string;
}

// Form types
export interface CreateRecipeForm {
  name: string;
  style?: string;
  target_volume?: number;
  target_og?: number;
  target_fg?: number;
  target_abv?: number;
  target_ibu?: number;
  target_srm?: number;
  target_ph?: number;
  efficiency_pct?: number;
  notes?: string;
}

export interface CreateBatchForm {
  batch_number: string;
  recipe_version_id: string;
  brew_date?: string;
  target_volume?: number;
  tank_id?: string;
}

export interface FermReadingForm {
  sg?: number;
  temp?: number;
  ph?: number;
  pressure?: number;
  notes?: string;
}